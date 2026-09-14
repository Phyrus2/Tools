param(
  [ValidateRange(5, 1440)]
  [int]$IntervalMinutes = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stopSignalPath = Join-Path $root '.server-state\stop-backup-worker'
$backupScript = Join-Path $PSScriptRoot 'backup-database.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$intervalSeconds = $IntervalMinutes * 60

Write-Output "[$([DateTimeOffset]::Now.ToString('o'))] Worker backup aktif. Interval: $IntervalMinutes menit."

while (-not (Test-Path -LiteralPath $stopSignalPath)) {
  $waitedSeconds = 0
  while ($waitedSeconds -lt $intervalSeconds -and -not (Test-Path -LiteralPath $stopSignalPath)) {
    $sleepSeconds = [Math]::Min(5, $intervalSeconds - $waitedSeconds)
    Start-Sleep -Seconds $sleepSeconds
    $waitedSeconds += $sleepSeconds
  }

  if (Test-Path -LiteralPath $stopSignalPath) { break }

  Write-Output "[$([DateTimeOffset]::Now.ToString('o'))] Memulai backup terjadwal."
  & $powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript
  if ($LASTEXITCODE -eq 0) {
    Write-Output "[$([DateTimeOffset]::Now.ToString('o'))] Backup terjadwal selesai."
  } else {
    Write-Error "[$([DateTimeOffset]::Now.ToString('o'))] Backup terjadwal gagal (exit code $LASTEXITCODE). Akan dicoba lagi pada jadwal berikutnya."
  }
}

Write-Output "[$([DateTimeOffset]::Now.ToString('o'))] Worker backup berhenti."
