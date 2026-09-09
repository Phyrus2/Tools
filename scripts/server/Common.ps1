Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Read-DotEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "File .env tidak ditemukan: $Path"
  }

  $settings = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $settings[$name] = $value
  }
  return $settings
}

function Get-Setting {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Settings,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Default = '',
    [switch]$Required
  )

  $value = if ($Settings.ContainsKey($Name)) { [string]$Settings[$Name] } else { $Default }
  if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
    throw "Konfigurasi $Name wajib diisi di .env."
  }
  return $value
}

function Resolve-ToolPath {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$ConfiguredPath,
    [string[]]$Candidates = @()
  )

  if ($ConfiguredPath) {
    $expanded = [Environment]::ExpandEnvironmentVariables($ConfiguredPath)
    if (-not [IO.Path]::IsPathRooted($expanded)) {
      $expanded = Join-Path (Get-ProjectRoot) $expanded
    }
    if (Test-Path -LiteralPath $expanded) { return (Resolve-Path $expanded).Path }
  }

  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) { return $command.Source }

  foreach ($candidate in $Candidates) {
    $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
    $match = Get-Item $expanded -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) { return $match.FullName }
  }

  throw "$Name tidak ditemukan. Instal aplikasinya atau isi path-nya di .env."
}

function Resolve-GitPath {
  param([hashtable]$Settings)

  $desktopCandidates = @(
    "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe",
    "$env:ProgramFiles\Git\cmd\git.exe"
  )
  return Resolve-ToolPath -Name 'git' -ConfiguredPath (Get-Setting $Settings 'GIT_PATH') -Candidates $desktopCandidates
}

function Resolve-MySqlTool {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [hashtable]$Settings
  )

  $settingName = if ($Executable -eq 'mysql') { 'MYSQL_PATH' } else { 'MYSQLDUMP_PATH' }
  $candidates = @(
    "C:\laragon\bin\mysql\*\bin\$Executable.exe",
    "C:\laragon\bin\mariadb\*\bin\$Executable.exe",
    "D:\laragon\bin\mysql\*\bin\$Executable.exe",
    "D:\laragon\bin\mariadb\*\bin\$Executable.exe",
    "C:\xampp\mysql\bin\$Executable.exe",
    "$env:ProgramFiles\MySQL\MySQL Server *\bin\$Executable.exe",
    "$env:ProgramFiles\MariaDB *\bin\$Executable.exe"
  )
  return Resolve-ToolPath -Name $Executable -ConfiguredPath (Get-Setting $Settings $settingName) -Candidates $candidates
}

function Initialize-ServerDirectories {
  $root = Get-ProjectRoot
  $stateDirectory = Join-Path $root '.server-state'
  $logDirectory = Join-Path $root '.server-logs'
  New-Item -ItemType Directory -Force -Path $stateDirectory, $logDirectory | Out-Null
  return @{ Root = $root; State = $stateDirectory; Logs = $logDirectory }
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function ConvertTo-MySqlOptionValue {
  param([string]$Value)
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function New-MySqlDefaultsFile {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Settings,
    [Parameter(Mandatory = $true)][string]$Directory
  )

  $path = Join-Path $Directory ("mysql-client-{0}.cnf" -f [guid]::NewGuid().ToString('N'))
  $content = @(
    '[client]',
    ('host=' + (ConvertTo-MySqlOptionValue (Get-Setting $Settings 'DB_HOST' -Required))),
    ('port=' + (Get-Setting $Settings 'DB_PORT' -Default '3306')),
    ('user=' + (ConvertTo-MySqlOptionValue (Get-Setting $Settings 'DB_USER' -Required))),
    ('password=' + (ConvertTo-MySqlOptionValue (Get-Setting $Settings 'DB_PASSWORD'))),
    'default-character-set=utf8mb4'
  ) -join [Environment]::NewLine
  [IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))
  return $path
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$FailureMessage = 'Perintah gagal.'
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage Exit code: $LASTEXITCODE"
  }
}

function Compress-GzipFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $inputStream = [IO.File]::OpenRead($Source)
  try {
    $outputStream = [IO.File]::Create($Destination)
    try {
      $gzip = [IO.Compression.GZipStream]::new($outputStream, [IO.Compression.CompressionLevel]::Optimal)
      try { $inputStream.CopyTo($gzip) } finally { $gzip.Dispose() }
    } finally { $outputStream.Dispose() }
  } finally { $inputStream.Dispose() }
}

function Expand-GzipFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $inputStream = [IO.File]::OpenRead($Source)
  try {
    $gzip = [IO.Compression.GZipStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
    try {
      $outputStream = [IO.File]::Create($Destination)
      try { $gzip.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $gzip.Dispose() }
  } finally { $inputStream.Dispose() }
}

function Assert-DatabaseName {
  param([Parameter(Mandatory = $true)][string]$Name)
  if ($Name -notmatch '^[A-Za-z0-9_]+$') {
    throw 'DB_NAME hanya boleh berisi huruf, angka, dan underscore.'
  }
}

function Invoke-DatabaseDump {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Settings,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$TemporaryDirectory
  )

  $databaseName = Get-Setting $Settings 'DB_NAME' -Required
  Assert-DatabaseName $databaseName
  $dumpTool = Resolve-MySqlTool -Executable 'mysqldump' -Settings $Settings
  $defaultsFile = New-MySqlDefaultsFile -Settings $Settings -Directory $TemporaryDirectory
  try {
    $arguments = @(
      "--defaults-extra-file=$($defaultsFile.Replace('\', '/'))",
      '--single-transaction', '--quick', '--routines', '--triggers', '--events',
      '--hex-blob', '--default-character-set=utf8mb4',
      "--result-file=$($OutputPath.Replace('\', '/'))",
      $databaseName
    )
    Invoke-CheckedCommand $dumpTool $arguments 'Backup MySQL gagal.'
    if (-not (Test-Path $OutputPath) -or (Get-Item $OutputPath).Length -eq 0) {
      throw 'Backup MySQL kosong.'
    }
  } finally {
    Remove-Item -LiteralPath $defaultsFile -Force -ErrorAction SilentlyContinue
  }
}

function Restore-DatabaseDump {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Settings,
    [Parameter(Mandatory = $true)][string]$SqlPath,
    [Parameter(Mandatory = $true)][string]$TemporaryDirectory
  )

  $databaseName = Get-Setting $Settings 'DB_NAME' -Required
  Assert-DatabaseName $databaseName
  $mysqlTool = Resolve-MySqlTool -Executable 'mysql' -Settings $Settings
  $defaultsFile = New-MySqlDefaultsFile -Settings $Settings -Directory $TemporaryDirectory
  try {
    Invoke-CheckedCommand $mysqlTool @(
      "--defaults-extra-file=$($defaultsFile.Replace('\', '/'))",
      '--execute', "DROP DATABASE IF EXISTS ``$databaseName``; CREATE DATABASE ``$databaseName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    ) 'Tidak dapat menyiapkan database untuk restore.'

    $process = Start-Process -FilePath $mysqlTool -ArgumentList @(
      "--defaults-extra-file=$($defaultsFile.Replace('\', '/'))", $databaseName
    ) -RedirectStandardInput $SqlPath -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "Restore MySQL gagal. Exit code: $($process.ExitCode)"
    }
  } finally {
    Remove-Item -LiteralPath $defaultsFile -Force -ErrorAction SilentlyContinue
  }
}

function Start-ConfiguredMySqlService {
  param([hashtable]$Settings)
  $serviceName = Get-Setting $Settings 'MYSQL_SERVICE_NAME'
  if (-not $serviceName) { return }

  $service = Get-Service -Name $serviceName -ErrorAction Stop
  if ($service.Status -ne 'Running') {
    Start-Service -Name $serviceName
    $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  }
}

function Wait-ForHttpSuccess {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return }
    } catch {}
    Start-Sleep -Milliseconds 750
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Service tidak siap dalam $TimeoutSeconds detik: $Uri"
}

function Stop-RecordedProcess {
  param(
    [Nullable[int]]$Id,
    [string]$ExpectedName
  )
  if (-not $Id) { return }
  $process = Get-Process -Id $Id.Value -ErrorAction SilentlyContinue
  if (-not $process) { return }
  if ($ExpectedName -and $process.ProcessName -ne $ExpectedName) {
    throw "PID $Id sekarang dimiliki proses $($process.ProcessName), bukan $ExpectedName."
  }
  Stop-Process -Id $Id.Value -Force
  $process.WaitForExit(10000)
}
