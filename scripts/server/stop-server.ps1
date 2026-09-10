param([switch]$CheckOnly)

. (Join-Path $PSScriptRoot 'Common.ps1')

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$processStatePath = Join-Path $directories.State 'processes.json'

if ($CheckOnly) {
  & (Join-Path $PSScriptRoot 'backup-database.ps1') -CheckOnly
  Write-Host 'Konfigurasi stop server valid.' -ForegroundColor Green
  exit 0
}

if (Test-Path -LiteralPath $processStatePath) {
  $processState = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json

  Write-Host 'Menutup akses publik Cloudflare Tunnel...'
  Stop-RecordedProcess -Id $processState.cloudflared_pid -ExpectedName 'cloudflared'

  # Beri kesempatan request lokal yang tersisa selesai sebelum Node dihentikan.
  Start-Sleep -Seconds 2
  Write-Host 'Menghentikan backend Node.js...'
  Stop-RecordedProcess -Id $processState.node_pid -ExpectedName 'node'
  Remove-Item -LiteralPath $processStatePath -Force
} else {
  Write-Host 'Server tidak sedang berjalan. Melanjutkan backup database terbaru.'
}

try {
  & (Join-Path $PSScriptRoot 'backup-database.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Script backup database gagal.' }
  Write-Host 'Server aman dimatikan atau dipindahkan ke PC lain.' -ForegroundColor Green
} catch {
  Write-Error "Backup belum berhasil. Jangan matikan PC sebelum masalah diperbaiki. $($_.Exception.Message)"
  exit 1
}
