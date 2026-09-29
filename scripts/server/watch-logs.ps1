param(
  [ValidateRange(0, 500)]
  [int]$Tail = 30,
  [ValidateRange(100, 10000)]
  [int]$PollMilliseconds = 500
)

. (Join-Path $PSScriptRoot 'Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}

$directories = Initialize-ServerDirectories
$definitions = @(
  @{ Name = 'WATCHDOG'; File = 'watchdog.log';          Color = 'Cyan' },
  @{ Name = 'NODE';     File = 'node.out.log';          Color = 'Green' },
  @{ Name = 'NODE ERR'; File = 'node.err.log';          Color = 'Red' },
  @{ Name = 'TUNNEL';   File = 'cloudflared.out.log';   Color = 'Magenta' },
  @{ Name = 'TUNNEL !'; File = 'cloudflared.err.log';   Color = 'DarkMagenta' },
  @{ Name = 'BACKUP';   File = 'backup-worker.out.log'; Color = 'Yellow' },
  @{ Name = 'BACKUP !'; File = 'backup-worker.err.log'; Color = 'DarkYellow' }
)

function Write-LogLine {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Color,
    [AllowEmptyString()][string]$Line
  )

  $timestamp = [DateTime]::Now.ToString('HH:mm:ss')
  Write-Host "[$timestamp] [$Source] " -NoNewline -ForegroundColor $Color
  Write-Host $Line
}

function Read-NewLogContent {
  param([Parameter(Mandatory = $true)]$State)

  if (-not (Test-Path -LiteralPath $State.Path)) {
    if ($State.Exists) {
      Write-LogLine -Source $State.Name -Color $State.Color -Line 'File log dihapus; menunggu dibuat kembali...'
      $State.Exists = $false
      $State.Position = [int64]0
      $State.Pending = ''
    }
    return
  }

  $file = Get-Item -LiteralPath $State.Path
  if (-not $State.Exists) {
    $State.Exists = $true
    $State.Position = [int64]0
    $State.Pending = ''
    Write-LogLine -Source $State.Name -Color $State.Color -Line 'File log tersedia.'
  } elseif ($file.Length -lt $State.Position) {
    $State.Position = [int64]0
    $State.Pending = ''
    Write-LogLine -Source $State.Name -Color $State.Color -Line 'Log dimulai ulang setelah restart/rotasi.'
  }

  if ($file.Length -le $State.Position) { return }

  $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
  $stream = [IO.File]::Open($State.Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
  try {
    [void]$stream.Seek($State.Position, [IO.SeekOrigin]::Begin)
    $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false), $true)
    try {
      $text = $reader.ReadToEnd()
      $State.Position = $stream.Position
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }

  if (-not $text) { return }
  $combined = $State.Pending + $text
  $parts = [regex]::Split($combined, '\r?\n')
  $completeCount = $parts.Count
  if (-not $combined.EndsWith("`n")) {
    $State.Pending = $parts[$parts.Count - 1]
    $completeCount--
  } else {
    $State.Pending = ''
    $completeCount--
  }

  for ($index = 0; $index -lt $completeCount; $index++) {
    Write-LogLine -Source $State.Name -Color $State.Color -Line $parts[$index]
  }
}

$states = foreach ($definition in $definitions) {
  $path = Join-Path $directories.Logs $definition.File
  $exists = Test-Path -LiteralPath $path
  $position = if ($exists) { (Get-Item -LiteralPath $path).Length } else { [int64]0 }

  if ($exists -and $Tail -gt 0) {
    foreach ($line in Get-Content -LiteralPath $path -Tail $Tail -Encoding UTF8 -ErrorAction SilentlyContinue) {
      Write-LogLine -Source $definition.Name -Color $definition.Color -Line ([string]$line)
    }
  }

  [pscustomobject]@{
    Name = $definition.Name
    Color = $definition.Color
    Path = $path
    Exists = $exists
    Position = [int64]$position
    Pending = ''
  }
}

Write-Host ''
Write-Host 'Memantau log server secara real time. Tekan Ctrl+C untuk menutup monitor.' -ForegroundColor White
Write-Host "Folder log: $($directories.Logs)" -ForegroundColor DarkGray
Write-Host 'Menutup monitor tidak menghentikan server.' -ForegroundColor DarkGray

$statusPath = Join-Path $directories.State 'watchdog-status.json'
if (Test-Path -LiteralPath $statusPath) {
  try {
    $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "Status saat ini: $($status.state) / $($status.phase) - $($status.detail)" -ForegroundColor Cyan
  } catch {}
}

try {
  $scheduledTask = Get-ScheduledTask -TaskName 'C2I Tools Server' -ErrorAction SilentlyContinue
  if ($scheduledTask) {
    $taskDirectory = [string](@($scheduledTask.Actions)[0].WorkingDirectory)
    if ($taskDirectory -and
        -not [string]::Equals($taskDirectory.TrimEnd('\'), $directories.Root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
      Write-Host 'PERINGATAN: Scheduled Task memakai copy project yang berbeda.' -ForegroundColor Red
      Write-Host "Task      : $taskDirectory" -ForegroundColor Red
      Write-Host "Monitor   : $($directories.Root)" -ForegroundColor Red
    }
  }
} catch {}
Write-Host ''

while ($true) {
  foreach ($state in $states) {
    try {
      Read-NewLogContent -State $state
    } catch {
      Write-LogLine -Source $state.Name -Color 'Red' -Line "Monitor gagal membaca log: $($_.Exception.Message)"
    }
  }
  Start-Sleep -Milliseconds $PollMilliseconds
}
