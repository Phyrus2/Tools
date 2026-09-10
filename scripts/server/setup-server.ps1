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

function Test-RcloneRemoteAccess {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $rclone lsd "${remoteName}:" *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Test-GitHubAuthentication {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $gh auth status *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

$availableRemotes = @(& $rclone listremotes)
if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi rclone tidak dapat dibaca.' }
$remoteExists = $availableRemotes -contains "${remoteName}:"
$remoteWorks = $remoteExists -and (Test-RcloneRemoteAccess)
if (-not $remoteWorks) {
  if ($remoteExists) {
    Write-Host "Remote '${remoteName}' ada, tetapi akses Google Drive belum berhasil." -ForegroundColor Yellow
    Write-Host "Pilih e untuk memperbaiki atau d untuk menghapus lalu buat ulang '${remoteName}'."
  } else {
    Write-Host "Remote Google Drive '${remoteName}' belum ada."
  }
  Write-Host 'Membuka konfigurasi rclone...'
  & $rclone config
  if ($LASTEXITCODE -ne 0) { throw 'Konfigurasi rclone belum berhasil.' }
  $availableRemotes = @(& $rclone listremotes)
  if ($availableRemotes -notcontains "${remoteName}:") {
    throw "Remote harus dibuat dengan nama '${remoteName}'."
  }
  if (-not (Test-RcloneRemoteAccess)) {
    throw "Remote '${remoteName}' belum dapat mengakses Google Drive. Setup belum selesai."
  }
}

if (-not (Test-GitHubAuthentication)) {
  Write-Host 'GitHub CLI belum login. Membuka autentikasi GitHub...'
  & $gh auth login
  if ($LASTEXITCODE -ne 0) { throw 'Login GitHub belum berhasil.' }
  if (-not (Test-GitHubAuthentication)) {
    throw 'GitHub CLI masih belum terautentikasi. Setup belum selesai.'
  }
}

Write-Host 'Persiapan akun server selesai.' -ForegroundColor Green
Write-Host 'Jalankan: npm run server:up'
