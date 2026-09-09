param([switch]$CheckOnly)

. (Join-Path $PSScriptRoot 'Common.ps1')

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$remote = (Get-Setting $settings 'BACKUP_REMOTE' -Default 'gdrive:C2I-Server-Backup').TrimEnd('/')
$serverId = Get-Setting $settings 'SERVER_ID' -Default $env:COMPUTERNAME
$rclone = Resolve-ToolPath -Name 'rclone' -ConfiguredPath (Get-Setting $settings 'RCLONE_PATH')
$null = Resolve-MySqlTool -Executable 'mysqldump' -Settings $settings

if ($serverId -notmatch '^[A-Za-z0-9_-]+$') {
  throw 'SERVER_ID hanya boleh berisi huruf, angka, dash, dan underscore.'
}

if ($CheckOnly) {
  Write-Host "Konfigurasi backup valid. Remote: $remote; Server: $serverId" -ForegroundColor Green
  exit 0
}

$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$backupId = "$timestamp-$serverId"
$archiveName = "c2i-data-$backupId.sql.gz"
$temporaryDirectory = Join-Path $directories.State ("backup-{0}" -f [guid]::NewGuid().ToString('N'))
$sqlPath = Join-Path $temporaryDirectory 'database.sql'
$archivePath = Join-Path $temporaryDirectory $archiveName
$manifestPath = Join-Path $temporaryDirectory 'latest.json'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
  Write-Host 'Membuat backup MySQL yang konsisten...'
  Invoke-DatabaseDump -Settings $settings -OutputPath $sqlPath -TemporaryDirectory $temporaryDirectory
  Compress-GzipFile -Source $sqlPath -Destination $archivePath
  $checksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $archiveSize = (Get-Item -LiteralPath $archivePath).Length

  $manifest = [ordered]@{
    backup_id = $backupId
    created_at = [DateTime]::UtcNow.ToString('o')
    server_id = $serverId
    database = Get-Setting $settings 'DB_NAME' -Required
    file = $archiveName
    sha256 = $checksum
    size = $archiveSize
  }
  Write-JsonFile -Value $manifest -Path $manifestPath

  Write-Host 'Mengunggah backup ke Google Drive...'
  Invoke-CheckedCommand $rclone @('copyto', $archivePath, "$remote/archives/$archiveName", '--retries', '3') 'Upload arsip database gagal.'
  Invoke-CheckedCommand $rclone @('copyto', $manifestPath, "$remote/latest.json", '--retries', '3') 'Upload latest.json gagal.'

  Write-JsonFile -Value $manifest -Path (Join-Path $directories.State 'local-database-state.json')
  Write-Host "Backup berhasil: $backupId" -ForegroundColor Green
  Write-Host "SHA-256: $checksum"
} finally {
  Remove-Item -LiteralPath $sqlPath, $archivePath, $manifestPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $temporaryDirectory -Force -ErrorAction SilentlyContinue
}
