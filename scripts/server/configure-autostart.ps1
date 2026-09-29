param(
  [ValidateSet('Install', 'Uninstall', 'Start', 'Stop', 'Status')]
  [string]$Action = 'Install',
  [string]$TaskName = 'C2I Tools Server'
)

. (Join-Path $PSScriptRoot 'Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$directories = Initialize-ServerDirectories
$watchdogScript = Join-Path $PSScriptRoot 'server-watchdog.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop-server.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Buka PowerShell dengan Run as administrator, lalu jalankan perintah ini kembali.'
  }
}

function Get-TaskOrNull {
  return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Set-DotEnvSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $lines = @(Get-Content -LiteralPath $Path)
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match ("^\s*{0}\s*=" -f [regex]::Escape($Name))) {
      $lines[$index] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines += "$Name=$Value" }
  [IO.File]::WriteAllText($Path, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}

function Initialize-DatabaseService {
  param([Parameter(Mandatory = $true)][hashtable]$Settings)

  $envPath = Join-Path $directories.Root '.env'
  $configuredName = Get-Setting $Settings 'MYSQL_SERVICE_NAME'
  if ($configuredName) {
    $configuredService = Get-Service -Name $configuredName -ErrorAction SilentlyContinue
    if (-not $configuredService) {
      throw "Windows Service database '$configuredName' tidak ditemukan."
    }
    Set-Service -Name $configuredName -StartupType Automatic
    if ($configuredService.Status -ne 'Running') {
      Start-Service -Name $configuredName
      $configuredService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
    return $configuredName
  }

  # Jika installer pernah selesai sebagian, gunakan kembali service yang sudah dibuat.
  $serviceName = 'C2IToolsMySQL'
  $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $existingService) {
    $otherDatabaseServices = @(Get-CimInstance Win32_Service | Where-Object {
      $_.PathName -match '(?i)\\mysqld\.exe(?:"|\s|$)'
    })
    if ($otherDatabaseServices.Count -eq 1) {
      $serviceName = [string]$otherDatabaseServices[0].Name
      $existingService = Get-Service -Name $serviceName
    } elseif ($otherDatabaseServices.Count -gt 1) {
      $names = ($otherDatabaseServices.Name -join ', ')
      throw "Ada beberapa service MySQL/MariaDB ($names). Isi MYSQL_SERVICE_NAME di .env secara manual."
    }
  }

  if (-not $existingService) {
    $runningMySql = Get-Process -Name 'mysqld', 'mariadbd' -ErrorAction SilentlyContinue
    if ($runningMySql) {
      throw @'
MySQL sedang berjalan dari Laragon, tetapi belum menjadi Windows Service. Klik Stop All
dan tutup Laragon, kemudian jalankan instalasi autostart ini lagi sebagai Administrator.
'@
    }

    $mysqlClient = Resolve-MySqlTool -Executable 'mysql' -Settings $Settings
    $binaryDirectory = Split-Path -Parent $mysqlClient
    $mysqld = Join-Path $binaryDirectory 'mysqld.exe'
    if (-not (Test-Path -LiteralPath $mysqld)) {
      throw "mysqld.exe tidak ditemukan di $binaryDirectory. Daftarkan database sebagai service secara manual."
    }

    $optionFile = Join-Path (Split-Path -Parent $binaryDirectory) 'my.ini'
    if (-not (Test-Path -LiteralPath $optionFile)) {
      throw "my.ini tidak ditemukan di $optionFile. Daftarkan database sebagai service secara manual."
    }

    Write-Host "Mendaftarkan MySQL Laragon sebagai Windows Service '$serviceName'..."
    & $mysqld '--install' $serviceName "--defaults-file=$optionFile"
    if ($LASTEXITCODE -ne 0) {
      throw "Pendaftaran Windows Service MySQL gagal dengan exit code $LASTEXITCODE."
    }
    $existingService = Get-Service -Name $serviceName -ErrorAction Stop
  }

  Set-Service -Name $serviceName -StartupType Automatic
  if ($existingService.Status -ne 'Running') {
    Start-Service -Name $serviceName
    $existingService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  }
  Set-DotEnvSetting -Path $envPath -Name 'MYSQL_SERVICE_NAME' -Value $serviceName
  Write-Host "Database service siap: $serviceName" -ForegroundColor Green
  return $serviceName
}

function Stop-ServerProcesses {
  $statePath = Join-Path $directories.State 'processes.json'
  if (-not (Test-Path -LiteralPath $statePath)) { return }

  Write-Host 'Menghentikan server dengan backup final...'
  & $powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript
  if ($LASTEXITCODE -ne 0) {
    throw 'Server berhenti, tetapi backup final gagal. Periksa log sebelum mematikan PC.'
  }
}

switch ($Action) {
  'Install' {
    Assert-Administrator
    $settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
    $mysqlServiceName = Initialize-DatabaseService -Settings $settings

    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Write-Host "Task akan berjalan sebagai $currentUser meskipun belum login."
    Write-Host 'Masukkan PASSWORD akun Windows, bukan PIN.' -ForegroundColor Yellow
    $credential = Get-Credential -UserName $currentUser -Message 'Kredensial untuk menjalankan server saat Windows boot'
    if (-not $credential) { throw 'Instalasi dibatalkan karena kredensial tidak diberikan.' }

    $securePassword = $credential.Password
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
      $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
      $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument (
        '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $watchdogScript
      ) -WorkingDirectory $directories.Root
      $trigger = New-ScheduledTaskTrigger -AtStartup
      $trigger.Delay = 'PT1M'
      $settingsSet = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

      Register-ScheduledTask -TaskName $TaskName -Description (
        'Menjalankan dan memantau C2I Tools Server sejak Windows boot, tanpa menunggu login.'
      ) -Action $taskAction -Trigger $trigger -Settings $settingsSet `
        -User $credential.UserName -Password $plainPassword -RunLevel Highest -Force | Out-Null
    } finally {
      if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
      }
      $plainPassword = $null
    }

    # Server tidak boleh sleep/hibernate saat mendapat listrik AC.
    & powercfg.exe /change standby-timeout-ac 0
    & powercfg.exe /change hibernate-timeout-ac 0

    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Autostart terpasang dan task '$TaskName' sudah dijalankan." -ForegroundColor Green
    Write-Host "Log watchdog: $($directories.Logs)\watchdog.log"
  }

  'Uninstall' {
    Assert-Administrator
    $task = Get-TaskOrNull
    if ($task) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      Stop-ServerProcesses
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Write-Host 'Autostart sudah dihapus.' -ForegroundColor Green
  }

  'Start' {
    Assert-Administrator
    if (-not (Get-TaskOrNull)) { throw "Task '$TaskName' belum terpasang." }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host 'Task autostart dijalankan.' -ForegroundColor Green
  }

  'Stop' {
    Assert-Administrator
    if (Get-TaskOrNull) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    Stop-ServerProcesses
    Write-Host 'Task dan server sudah dihentikan. Task akan aktif lagi pada boot berikutnya.' -ForegroundColor Green
  }

  'Status' {
    $task = Get-TaskOrNull
    if (-not $task) {
      Write-Host "Task '$TaskName' belum terpasang." -ForegroundColor Yellow
      exit 1
    }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task state : $($task.State)"
    Write-Host "Last run   : $($info.LastRunTime)"
    Write-Host "Last result: $($info.LastTaskResult)"
    Write-Host "Next run   : saat Windows boot"
    Write-Host "Log        : $($directories.Logs)\watchdog.log"
    $taskAction = @($task.Actions)[0]
    Write-Host "Task folder: $($taskAction.WorkingDirectory)"
    Write-Host "Project    : $($directories.Root)"
    if ($taskAction.WorkingDirectory -and
        -not [string]::Equals($taskAction.WorkingDirectory.TrimEnd('\'), $directories.Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
      Write-Host 'PERINGATAN: task memakai copy project yang berbeda. Jalankan install ulang dari folder yang benar.' -ForegroundColor Red
    }
  }
}
