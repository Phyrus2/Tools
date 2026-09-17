param(
  [switch]$DownloadOnly,
  [string]$OutputDirectory,
  [switch]$Force
)

. (Join-Path $PSScriptRoot 'Common.ps1')

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$remote = (Get-Setting $settings 'BACKUP_REMOTE' -Default 'gdrive:C2I-Server-Backup').TrimEnd('/')
$rclone = Resolve-RclonePath $settings

if (-not $DownloadOnly) {
  $processStatePath = Join-Path $directories.State 'processes.json'
  if (Test-Path -LiteralPath $processStatePath) {
    $processState = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
    $runningProcesses = @(
      $processState.node_pid,
      $processState.cloudflared_pid,
      $processState.backup_worker_pid
    ) | Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) }

    if ($runningProcesses.Count -gt 0) {
      throw 'Server atau worker backup masih aktif. Jalankan npm run server:down sebelum restore.'
    }
  }

  $null = Resolve-MySqlTool -Executable 'mysql' -Settings $settings
  Start-ConfiguredMySqlService $settings
}

$temporaryDirectory = Join-Path $directories.State ("restore-manual-{0}" -f [guid]::NewGuid().ToString('N'))
$manifestPath = Join-Path $temporaryDirectory 'latest.json'
$archivePath = Join-Path $temporaryDirectory 'database.sql.gz'
$sqlPath = Join-Path $temporaryDirectory 'database.sql'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
  Write-Host 'Mengambil informasi backup terbaru dari Google Drive...'
  Invoke-CheckedCommand $rclone @(
    'copyto', "$remote/latest.json", $manifestPath, '--retries', '3'
  ) 'latest.json tidak dapat diunduh dari Google Drive.'

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  foreach ($property in @('backup_id', 'database', 'file', 'sha256')) {
    if (-not $manifest.$property) { throw "latest.json tidak valid: $property kosong." }
  }

  if ([IO.Path]::GetFileName([string]$manifest.file) -ne [string]$manifest.file) {
    throw 'latest.json tidak valid: nama file arsip mengandung path.'
  }

  $configuredDatabase = Get-Setting $settings 'DB_NAME' -Required
  if ([string]$manifest.database -ne $configuredDatabase) {
    throw "Nama database backup tidak cocok: $($manifest.database)."
  }

  Write-Host "Mengunduh backup $($manifest.backup_id)..."
  Invoke-CheckedCommand $rclone @(
    'copyto', "$remote/archives/$($manifest.file)", $archivePath, '--retries', '3'
  ) 'Arsip backup tidak dapat diunduh dari Google Drive.'

  $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualChecksum -ne ([string]$manifest.sha256).ToLowerInvariant()) {
    throw 'Checksum backup tidak cocok. File tidak digunakan.'
  }
  Write-Host 'Checksum backup valid.' -ForegroundColor Green

  if ($DownloadOnly) {
    if (-not $OutputDirectory) {
      $OutputDirectory = Join-Path $directories.Root '.server-backups\downloads'
    } elseif (-not [IO.Path]::IsPathRooted($OutputDirectory)) {
      $OutputDirectory = Join-Path $directories.Root $OutputDirectory
    }

    New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
    $downloadedArchive = Join-Path $OutputDirectory ([string]$manifest.file)
    $downloadedManifest = Join-Path $OutputDirectory 'latest.json'
    Copy-Item -LiteralPath $archivePath -Destination $downloadedArchive -Force
    Copy-Item -LiteralPath $manifestPath -Destination $downloadedManifest -Force

    Write-Host 'Backup berhasil diunduh tanpa mengubah database.' -ForegroundColor Green
    Write-Host "Arsip: $downloadedArchive"
    Write-Host "Manifest: $downloadedManifest"
    exit 0
  }

  $localStatePath = Join-Path $directories.State 'local-database-state.json'
  if ((Test-Path -LiteralPath $localStatePath) -and -not $Force) {
    $localState = Get-Content -LiteralPath $localStatePath -Raw | ConvertFrom-Json
    if ($localState.created_at -and $manifest.created_at) {
      $localCreatedAt = [DateTimeOffset]::Parse([string]$localState.created_at)
      $remoteCreatedAt = [DateTimeOffset]::Parse([string]$manifest.created_at)
      if ($localCreatedAt -gt $remoteCreatedAt) {
        throw 'Database lokal tercatat lebih baru daripada backup Drive. Gunakan -Force hanya jika yakin ingin menimpanya.'
      }
    }
  }

  $databaseMarker = Get-DatabaseBackupMarker -Settings $settings -TemporaryDirectory $temporaryDirectory
  if (-not $Force -and $databaseMarker -eq [string]$manifest.backup_id) {
    Write-Host "Database sudah memakai backup terbaru: $($manifest.backup_id)" -ForegroundColor Green
    exit 0
  }

  Expand-GzipFile -Source $archivePath -Destination $sqlPath
  Write-Host "Merestore database '$configuredDatabase'..." -ForegroundColor Yellow
  Restore-DatabaseDump -Settings $settings -SqlPath $sqlPath -TemporaryDirectory $temporaryDirectory
  Set-DatabaseBackupMarker -Settings $settings -BackupId ([string]$manifest.backup_id) -TemporaryDirectory $temporaryDirectory
  Write-JsonFile -Value $manifest -Path $localStatePath

  Write-Host "Restore selesai: $($manifest.backup_id)" -ForegroundColor Green
  Write-Host 'Node/Express server tidak dijalankan.'
} finally {
  Remove-Item -LiteralPath $manifestPath, $archivePath, $sqlPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporaryDirectory -Force -ErrorAction SilentlyContinue
}
