param(
  [int]$HealthCheckIntervalSeconds = 15,
  [int]$InitialRetrySeconds = 30,
  [int]$MaximumRetrySeconds = 300
)

. (Join-Path $PSScriptRoot 'Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$port = Get-Setting $settings 'PORT' -Default '3000'
$statePath = Join-Path $directories.State 'processes.json'
$watchdogLog = Join-Path $directories.Logs 'watchdog.log'
$startScript = Join-Path $PSScriptRoot 'start-server.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop-server.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'

function Write-WatchdogLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = '{0} {1}' -f [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'), $Message
  Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
}

function Invoke-ServerScript {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $stdoutPath = Join-Path $directories.State ("watchdog-{0}-{1}.out" -f $Operation, [guid]::NewGuid().ToString('N'))
  $stderrPath = Join-Path $directories.State ("watchdog-{0}-{1}.err" -f $Operation, [guid]::NewGuid().ToString('N'))
  try {
    $process = Start-Process -FilePath $powershell -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`""
    ) -WorkingDirectory $directories.Root -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath -WindowStyle Hidden -Wait -PassThru

    foreach ($path in @($stdoutPath, $stderrPath)) {
      if (Test-Path -LiteralPath $path) {
        foreach ($line in Get-Content -LiteralPath $path) {
          if (-not [string]::IsNullOrWhiteSpace($line)) {
            Write-WatchdogLog "[$Operation] $line"
          }
        }
      }
    }
    return $process.ExitCode
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Test-ExpectedProcess {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][string]$Property,
    [Parameter(Mandatory = $true)][string[]]$ExpectedNames
  )

  if ($State.PSObject.Properties.Name -notcontains $Property) { return $false }
  $process = Get-Process -Id ([int]$State.$Property) -ErrorAction SilentlyContinue
  return $null -ne $process -and $process.ProcessName -in $ExpectedNames
}

function Test-ServerHealthy {
  if (-not (Test-Path -LiteralPath $statePath)) { return $false }

  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (-not (Test-ExpectedProcess $state 'node_pid' @('node'))) { return $false }
    if (-not (Test-ExpectedProcess $state 'cloudflared_pid' @('cloudflared'))) { return $false }
    if (-not (Test-ExpectedProcess $state 'backup_worker_pid' @('powershell', 'pwsh'))) { return $false }

    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Stop-UnhealthyServer {
  if (-not (Test-Path -LiteralPath $statePath)) { return }
  Write-WatchdogLog 'Server tidak sehat; mencoba shutdown dan backup sebelum restart.'
  try {
    $exitCode = Invoke-ServerScript -ScriptPath $stopScript -Operation 'stop'
    if ($exitCode -ne 0) {
      Write-WatchdogLog "Shutdown selesai dengan exit code $exitCode. Startup akan tetap dicoba ulang."
    }
  } catch {
    Write-WatchdogLog "Shutdown gagal: $($_.Exception.Message)"
  }
}

$mutexName = 'Global\C2IToolsServerWatchdog'
$mutex = [Threading.Mutex]::new($false, $mutexName)
$hasMutex = $false
try {
  $hasMutex = $mutex.WaitOne(0)
  if (-not $hasMutex) {
    Write-WatchdogLog 'Watchdog lain sudah berjalan; instance ini dihentikan.'
    exit 0
  }

  Write-WatchdogLog "Watchdog dimulai untuk $($directories.Root)."
  $retrySeconds = $InitialRetrySeconds

  while ($true) {
    if (Test-ServerHealthy) {
      $retrySeconds = $InitialRetrySeconds
      Start-Sleep -Seconds $HealthCheckIntervalSeconds
      continue
    }

    Stop-UnhealthyServer
    Write-WatchdogLog 'Menjalankan server:up.'
    try {
      $exitCode = Invoke-ServerScript -ScriptPath $startScript -Operation 'start'
      if ($exitCode -eq 0 -and (Test-ServerHealthy)) {
        Write-WatchdogLog 'Server berhasil dijalankan dan health check lulus.'
        $retrySeconds = $InitialRetrySeconds
        continue
      }
      Write-WatchdogLog "Startup belum berhasil (exit code $exitCode)."
    } catch {
      Write-WatchdogLog "Startup gagal: $($_.Exception.Message)"
    }

    Write-WatchdogLog "Mencoba lagi dalam $retrySeconds detik."
    Start-Sleep -Seconds $retrySeconds
    $retrySeconds = [Math]::Min($retrySeconds * 2, $MaximumRetrySeconds)
  }
} finally {
  if ($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
