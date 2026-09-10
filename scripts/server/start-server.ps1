param(
  [switch]$CheckOnly,
  [switch]$SkipGitPull,
  [switch]$SkipRestore,
  [switch]$SkipDeploy
)

. (Join-Path $PSScriptRoot 'Common.ps1')

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$remote = (Get-Setting $settings 'BACKUP_REMOTE' -Default 'gdrive:C2I-Server-Backup').TrimEnd('/')
$repository = Get-Setting $settings 'GITHUB_REPOSITORY'
$port = Get-Setting $settings 'PORT' -Default '3000'
$rclone = Resolve-RclonePath $settings
$git = Resolve-GitPath $settings
$gitDirectory = Split-Path -Parent $git
if (($env:PATH -split ';') -notcontains $gitDirectory) {
  $env:PATH = "$gitDirectory;$env:PATH"
}
$node = Resolve-ToolPath -Name 'node' -ConfiguredPath (Get-Setting $settings 'NODE_PATH')
$npm = Resolve-ToolPath -Name 'npm.cmd' -ConfiguredPath (Get-Setting $settings 'NPM_PATH')
$cloudflared = Resolve-ToolPath -Name 'cloudflared' -ConfiguredPath (Get-Setting $settings 'CLOUDFLARED_PATH' -Default 'cloudflare/cloudflared.exe')
$null = Resolve-MySqlTool -Executable 'mysql' -Settings $settings
$null = Resolve-MySqlTool -Executable 'mysqldump' -Settings $settings
$gh = $null
if (-not $SkipDeploy -or $CheckOnly) {
  $gh = Resolve-GitHubCliPath $settings
}

if ($CheckOnly) {
  $availableRemotes = @(& $rclone listremotes)
  if ($LASTEXITCODE -ne 0) { throw 'rclone belum siap.' }
  $remoteName = ($remote -split ':', 2)[0]
  if ($availableRemotes -notcontains "${remoteName}:") {
    throw "Remote rclone '${remoteName}' belum dibuat. Jalankan: .\.server-tools\rclone.exe config"
  }
  if ($gh) { Invoke-CheckedCommand $gh @('auth', 'status') 'GitHub CLI belum login.' }
  Write-Host 'Konfigurasi start server valid.' -ForegroundColor Green
  exit 0
}

$processStatePath = Join-Path $directories.State 'processes.json'
if (Test-Path -LiteralPath $processStatePath) {
  $existingState = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
  $nodeStillRuns = Get-Process -Id $existingState.node_pid -ErrorAction SilentlyContinue
  $tunnelStillRuns = Get-Process -Id $existingState.cloudflared_pid -ErrorAction SilentlyContinue
  if ($nodeStillRuns -or $tunnelStillRuns) {
    throw 'Server masih berjalan. Jalankan stop-server.ps1 terlebih dahulu.'
  }
  Remove-Item -LiteralPath $processStatePath -Force
}

if (-not $SkipDeploy) {
  $repoArguments = if ($repository) { @('--repo', $repository) } else { @() }
  $apiUrlArguments = @('variable', 'get', 'API_URL') + $repoArguments
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $publishedApiUrl = [string](@(& $gh @apiUrlArguments 2>$null) | Select-Object -Last 1)
    $apiUrlReadExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($apiUrlReadExitCode -eq 0 -and $publishedApiUrl -match '^https://') {
    $publishedServerIsActive = $false
    try {
      $activeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$($publishedApiUrl.TrimEnd('/'))/health" -TimeoutSec 8
      $publishedServerIsActive = $activeResponse.StatusCode -ge 200 -and $activeResponse.StatusCode -lt 300
    } catch {}
    if ($publishedServerIsActive) {
      throw "Server lain masih aktif di $publishedApiUrl. Jalankan server:down pada PC tersebut sebelum menyalakan PC ini."
    }
  }
}

if (-not $SkipGitPull) {
  Write-Host 'Mengambil kode terbaru dari GitHub...'
  Push-Location $directories.Root
  try { Invoke-CheckedCommand $git @('pull', '--ff-only', 'origin') 'git pull gagal.' }
  finally { Pop-Location }
  $settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
}

Start-ConfiguredMySqlService $settings

$createdInitialBackup = $false
if (-not $SkipRestore) {
  # Pastikan koneksi remote valid dan folder backup tersedia. Jika belum ada
  # manifest, database lokal pada PC pertama dijadikan backup awal otomatis.
  Invoke-CheckedCommand $rclone @('mkdir', $remote) 'Folder backup Google Drive tidak dapat diakses.'
  $remoteFiles = @(& $rclone lsf $remote '--files-only' '--max-depth' '1')
  if ($LASTEXITCODE -ne 0) { throw 'Daftar backup Google Drive tidak dapat dibaca.' }

  if (-not ($remoteFiles | Where-Object { $_.Trim() -eq 'latest.json' })) {
    Write-Host 'Backup Google Drive belum ada. Membuat backup awal dari database lokal...'
    $powershell = Join-Path $PSHOME 'powershell.exe'
    Invoke-CheckedCommand $powershell @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      (Join-Path $PSScriptRoot 'backup-database.ps1')
    ) 'Pembuatan backup awal gagal.'
    $createdInitialBackup = $true
  }
}

if (-not $SkipRestore -and -not $createdInitialBackup) {
  $temporaryDirectory = Join-Path $directories.State ("restore-{0}" -f [guid]::NewGuid().ToString('N'))
  $manifestPath = Join-Path $temporaryDirectory 'latest.json'
  $archivePath = Join-Path $temporaryDirectory 'database.sql.gz'
  $sqlPath = Join-Path $temporaryDirectory 'database.sql'
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

  try {
    Write-Host 'Mengambil backup terbaru dari Google Drive...'
    Invoke-CheckedCommand $rclone @('copyto', "$remote/latest.json", $manifestPath, '--retries', '3') 'latest.json tidak dapat diunduh. Jalankan stop-server.ps1 di PC sumber.'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

    foreach ($property in @('backup_id', 'database', 'file', 'sha256')) {
      if (-not $manifest.$property) { throw "latest.json tidak valid: $property kosong." }
    }
    if ($manifest.database -ne (Get-Setting $settings 'DB_NAME' -Required)) {
      throw "Nama database backup tidak cocok: $($manifest.database)."
    }

    $localStatePath = Join-Path $directories.State 'local-database-state.json'
    $localBackupId = ''
    if (Test-Path -LiteralPath $localStatePath) {
      $localState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
      $localBackupId = [string]$localState.backup_id
      if ($localState.created_at -and $manifest.created_at) {
        $localCreatedAt = [DateTimeOffset]::Parse([string]$localState.created_at)
        $remoteCreatedAt = [DateTimeOffset]::Parse([string]$manifest.created_at)
        if ($localCreatedAt -gt $remoteCreatedAt) {
          throw 'Database lokal tercatat lebih baru daripada backup Google Drive. Startup dibatalkan agar data tidak tertimpa.'
        }
      }
    }

    $databaseMarker = Get-DatabaseBackupMarker -Settings $settings -TemporaryDirectory $temporaryDirectory
    if ($localBackupId -eq [string]$manifest.backup_id -and
        $databaseMarker -eq [string]$manifest.backup_id) {
      Write-Host "Database sudah memakai backup terbaru: $localBackupId"
    } else {
      if ($localBackupId -eq [string]$manifest.backup_id) {
        Write-Host 'Penanda database hilang atau tidak cocok. Restore tetap dijalankan.' -ForegroundColor Yellow
      }
      Write-Host "Mengunduh backup $($manifest.backup_id)..."
      Invoke-CheckedCommand $rclone @('copyto', "$remote/archives/$($manifest.file)", $archivePath, '--retries', '3') 'File backup tidak dapat diunduh.'
      $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualChecksum -ne ([string]$manifest.sha256).ToLowerInvariant()) {
        throw 'Checksum backup tidak cocok. Restore dibatalkan.'
      }

      Expand-GzipFile -Source $archivePath -Destination $sqlPath
      Write-Host 'Merestore database terbaru...'
      Restore-DatabaseDump -Settings $settings -SqlPath $sqlPath -TemporaryDirectory $temporaryDirectory
      Set-DatabaseBackupMarker -Settings $settings -BackupId ([string]$manifest.backup_id) -TemporaryDirectory $temporaryDirectory
      Write-JsonFile -Value $manifest -Path $localStatePath
      Write-Host "Restore selesai: $($manifest.backup_id)" -ForegroundColor Green
    }
  } finally {
    Remove-Item -LiteralPath $manifestPath, $archivePath, $sqlPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporaryDirectory -Force -ErrorAction SilentlyContinue
  }
}

$lockPath = Join-Path $directories.Root 'package-lock.json'
$lockHashPath = Join-Path $directories.State 'package-lock.sha256'
$currentLockHash = (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
$installedLockHash = if (Test-Path $lockHashPath) { (Get-Content $lockHashPath -Raw).Trim() } else { '' }
if (-not (Test-Path (Join-Path $directories.Root 'node_modules')) -or $installedLockHash -ne $currentLockHash) {
  Write-Host 'Menginstal dependency backend...'
  Push-Location $directories.Root
  try { Invoke-CheckedCommand $npm @('ci') 'npm ci gagal.' }
  finally { Pop-Location }
  [IO.File]::WriteAllText($lockHashPath, $currentLockHash, [Text.UTF8Encoding]::new($false))
}

$nodeOut = Join-Path $directories.Logs 'node.out.log'
$nodeErr = Join-Path $directories.Logs 'node.err.log'
$tunnelOut = Join-Path $directories.Logs 'cloudflared.out.log'
$tunnelErr = Join-Path $directories.Logs 'cloudflared.err.log'
Remove-Item -LiteralPath $nodeOut, $nodeErr, $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue

$nodeProcess = $null
$tunnelProcess = $null
try {
  Write-Host 'Menjalankan backend Node.js...'
  $nodeProcess = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $directories.Root -RedirectStandardOutput $nodeOut -RedirectStandardError $nodeErr -WindowStyle Hidden -PassThru
  Wait-ForHttpSuccess -Uri "http://127.0.0.1:$port/health" -TimeoutSeconds 60

  Write-Host 'Menjalankan TryCloudflare...'
  $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$port") -WorkingDirectory $directories.Root -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -WindowStyle Hidden -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(75)
  $tunnelUrl = $null
  do {
    if ($tunnelProcess.HasExited) { throw 'cloudflared berhenti sebelum URL tersedia.' }
    $logText = @(
      (Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue),
      (Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue)
    ) -join [Environment]::NewLine
    $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $tunnelUrl = $match.Value; break }
    Start-Sleep -Milliseconds 750
  } while ([DateTime]::UtcNow -lt $deadline)

  if (-not $tunnelUrl) { throw 'URL TryCloudflare tidak ditemukan dalam 75 detik.' }
  Wait-ForHttpSuccess -Uri "$tunnelUrl/health" -TimeoutSeconds 60

  if (-not $SkipDeploy) {
    Write-Host "Memperbarui API_URL menjadi $tunnelUrl..."
    $repoArguments = if ($repository) { @('--repo', $repository) } else { @() }
    Invoke-CheckedCommand $gh (@('variable', 'set', 'API_URL', '--body', $tunnelUrl) + $repoArguments) 'Gagal memperbarui API_URL.'
    Invoke-CheckedCommand $gh (@('workflow', 'run', 'pages.yml') + $repoArguments) 'Gagal memicu deploy GitHub Pages.'
  }

  Write-JsonFile -Value ([ordered]@{
    node_pid = $nodeProcess.Id
    cloudflared_pid = $tunnelProcess.Id
    tunnel_url = $tunnelUrl
    started_at = [DateTime]::UtcNow.ToString('o')
  }) -Path $processStatePath

  Write-Host 'Server berhasil dijalankan.' -ForegroundColor Green
  Write-Host "Backend publik: $tunnelUrl"
  if (-not $SkipDeploy) { Write-Host 'Workflow GitHub Pages sudah dipicu.' }
} catch {
  if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force }
  if ($nodeProcess -and -not $nodeProcess.HasExited) { Stop-Process -Id $nodeProcess.Id -Force }
  throw
}
