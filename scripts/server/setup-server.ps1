. (Join-Path $PSScriptRoot 'Common.ps1')

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$remote = (Get-Setting $settings 'BACKUP_REMOTE' -Default 'gdrive:C2I-Server-Backup').TrimEnd('/')
$remoteName = ($remote -split ':', 2)[0]
$rclone = Resolve-RclonePath $settings
$gh = Resolve-GitHubCliPath $settings
$git = Resolve-GitPath $settings
$gitDirectory = Split-Path -Parent $git
if (($env:PATH -split ';') -notcontains $gitDirectory) {
  $env:PATH = "$gitDirectory;$env:PATH"
}

$availableRemotes = @(& $rclone listremotes)
if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi rclone tidak dapat dibaca.' }
if ($availableRemotes -notcontains "${remoteName}:") {
  Write-Host "Remote Google Drive '${remoteName}' belum ada. Membuka konfigurasi rclone..."
  & $rclone config
  if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi rclone belum berhasil.' }
  $availableRemotes = @(& $rclone listremotes)
  if ($availableRemotes -notcontains "${remoteName}:") {
    throw "Remote harus dibuat dengan nama '${remoteName}'."
  }
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $gh auth status *> $null
  $githubAuthExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($githubAuthExitCode -ne 0) {
  Write-Host 'GitHub CLI belum login. Membuka autentikasi GitHub...'
  & $gh auth login
  if ($LASTEXITCODE -ne 0) { throw 'Login GitHub belum berhasil.' }
}

Write-Host 'Persiapan akun server selesai.' -ForegroundColor Green
Write-Host 'Jalankan: npm run server:up'
