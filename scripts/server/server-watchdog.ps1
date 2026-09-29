param(
  [int]$HealthCheckIntervalSeconds = 15,
  [int]$HealthFailureThreshold = 3,
  [int]$InitialRetrySeconds = 30,
  [int]$MaximumRetrySeconds = 300
)

. (Join-Path $PSScriptRoot 'Common.ps1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$directories = Initialize-ServerDirectories
$settings = Read-DotEnvFile (Join-Path $directories.Root '.env')
$port = Get-Setting $settings 'PORT' -Default '3000'
$processStatePath = Join-Path $directories.State 'processes.json'
$watchdogStatusPath = Join-Path $directories.State 'watchdog-status.json'
$operationStatePath = Join-Path $directories.State 'watchdog-operation.json'
$watchdogLog = Join-Path $directories.Logs 'watchdog.log'
$startScript = Join-Path $PSScriptRoot 'start-server.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop-server.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'

function Write-WatchdogLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = '{0} {1}' -f [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'), $Message
  Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
}

function Set-WatchdogStatus {
  param(
    [Parameter(Mandatory = $true)][string]$State,
    [Parameter(Mandatory = $true)][string]$Phase,
    [string]$Detail = ''
  )

  Write-JsonFile -Path $watchdogStatusPath -Value ([ordered]@{
    state = $State
    phase = $Phase
    detail = $Detail
    updated_at = [DateTimeOffset]::Now.ToString('o')
  })
}

function Get-StartupPhase {
  param([string]$Line)

  switch -Regex ($Line) {
    'Mengambil kode terbaru'                    { return 'GIT_PULL' }
    'backup terbaru|Merestore database|database lokal|backup awal' { return 'DATABASE' }
    'Menginstal dependency'                     { return 'DEPENDENCIES' }
    'Menjalankan backend Node'                  { return 'NODE' }
    'Menjalankan TryCloudflare|Quick Tunnel'    { return 'TUNNEL' }
    'Memperbarui API_URL'                       { return 'PUBLISH_API_URL' }
    'Menunggu deployment|workflow GitHub Pages' { return 'DEPLOY_FRONTEND' }
    'Menjalankan backup otomatis'               { return 'BACKUP_WORKER' }
    'Server berhasil dijalankan'                { return 'COMPLETE' }
    default                                     { return '' }
  }
}

function Copy-NewOperationOutput {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][ref]$Position,
    [Parameter(Mandatory = $true)][ref]$Pending,
    [switch]$Flush
  )

  $text = ''
  if (Test-Path -LiteralPath $Path) {
    $file = Get-Item -LiteralPath $Path
    if ($file.Length -lt $Position.Value) {
      $Position.Value = [int64]0
      $Pending.Value = ''
    }
    if ($file.Length -gt $Position.Value) {
      $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
      $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
      try {
        [void]$stream.Seek($Position.Value, [IO.SeekOrigin]::Begin)
        $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false), $true)
        try {
          $text = $reader.ReadToEnd()
          $Position.Value = $stream.Position
        } finally {
          $reader.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
    }
  }

  $combined = $Pending.Value + $text
  if (-not $combined) { return }
  $parts = [regex]::Split($combined, '\r\n|\r|\n')
  $completeCount = $parts.Count
  if ($Flush -or $combined.EndsWith("`n") -or $combined.EndsWith("`r")) {
    $Pending.Value = ''
    if (-not $Flush) { $completeCount-- }
  } else {
    $Pending.Value = $parts[$parts.Count - 1]
    $completeCount--
  }

  for ($index = 0; $index -lt $completeCount; $index++) {
    $line = [string]$parts[$index]
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    Write-WatchdogLog "[$Operation] $line"
    if ($Operation -eq 'start') {
      $phase = Get-StartupPhase $line
      if ($phase) { Set-WatchdogStatus -State 'STARTING' -Phase $phase -Detail $line }
    }
  }
}

function Wait-ForOperationProcess {
  param(
    [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][string]$StdoutPath,
    [Parameter(Mandatory = $true)][string]$StderrPath
  )

  [int64]$stdoutPosition = 0
  [int64]$stderrPosition = 0
  $stdoutPending = ''
  $stderrPending = ''
  do {
    Copy-NewOperationOutput -Path $StdoutPath -Operation $Operation `
      -Position ([ref]$stdoutPosition) -Pending ([ref]$stdoutPending)
    Copy-NewOperationOutput -Path $StderrPath -Operation $Operation `
      -Position ([ref]$stderrPosition) -Pending ([ref]$stderrPending)
    $Process.Refresh()
    if (-not $Process.HasExited) { Start-Sleep -Milliseconds 250 }
  } while (-not $Process.HasExited)

  [void]$Process.WaitForExit()
  Copy-NewOperationOutput -Path $StdoutPath -Operation $Operation `
    -Position ([ref]$stdoutPosition) -Pending ([ref]$stdoutPending) -Flush
  Copy-NewOperationOutput -Path $StderrPath -Operation $Operation `
    -Position ([ref]$stderrPosition) -Pending ([ref]$stderrPending) -Flush

  try { return $Process.ExitCode } catch { return $null }
}

function Invoke-ServerScript {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [Parameter(Mandatory = $true)][ValidateSet('start', 'stop')][string]$Operation
  )

  $identifier = [guid]::NewGuid().ToString('N')
  $stdoutPath = Join-Path $directories.State ("watchdog-{0}-{1}.out" -f $Operation, $identifier)
  $stderrPath = Join-Path $directories.State ("watchdog-{0}-{1}.err" -f $Operation, $identifier)
  try {
    $process = Start-Process -FilePath $powershell -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`""
    ) -WorkingDirectory $directories.Root -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru

    Write-JsonFile -Path $operationStatePath -Value ([ordered]@{
      pid = $process.Id
      operation = $Operation
      stdout_path = $stdoutPath
      stderr_path = $stderrPath
      started_at = [DateTimeOffset]::Now.ToString('o')
    })
    return Wait-ForOperationProcess -Process $process -Operation $Operation `
      -StdoutPath $stdoutPath -StderrPath $stderrPath
  } finally {
    Remove-Item -LiteralPath $operationStatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Resume-InterruptedOperation {
  if (-not (Test-Path -LiteralPath $operationStatePath)) { return $false }

  try {
    $operationState = Get-Content -LiteralPath $operationStatePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$operationState.pid) -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -notin @('powershell', 'pwsh')) {
      Write-WatchdogLog 'Catatan operasi lama sudah tidak aktif dan dibersihkan.'
      return $false
    }

    $operation = [string]$operationState.operation
    Write-WatchdogLog "Melanjutkan pemantauan proses $operation yang masih berjalan (PID $($process.Id))."
    $resumedState = if ($operation -eq 'stop') { 'STOPPING' } else { 'STARTING' }
    Set-WatchdogStatus -State $resumedState -Phase 'RESUMED' -Detail "Memantau proses $operation PID $($process.Id)."
    $exitCode = Wait-ForOperationProcess -Process $process -Operation $operation `
      -StdoutPath ([string]$operationState.stdout_path) `
      -StderrPath ([string]$operationState.stderr_path)
    Write-WatchdogLog "Proses $operation yang dilanjutkan selesai (exit code $exitCode)."
    return $true
  } catch {
    Write-WatchdogLog "Gagal melanjutkan operasi sebelumnya: $($_.Exception.Message)"
    return $false
  } finally {
    if (Test-Path -LiteralPath $operationStatePath) {
      try {
        $staleState = Get-Content -LiteralPath $operationStatePath -Raw | ConvertFrom-Json
        Remove-Item -LiteralPath ([string]$staleState.stdout_path), ([string]$staleState.stderr_path) `
          -Force -ErrorAction SilentlyContinue
      } catch {}
    }
    Remove-Item -LiteralPath $operationStatePath -Force -ErrorAction SilentlyContinue
  }
}

function Get-ExpectedProcessProblem {
  param(
    [Parameter(Mandatory = $true)]$State,
    [Parameter(Mandatory = $true)][string]$Property,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$ExpectedNames
  )

  if ($State.PSObject.Properties.Name -notcontains $Property) { return "$Label belum memiliki PID." }
  $processId = [int]$State.$Property
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) { return "$Label tidak berjalan (PID $processId sudah mati)." }
  if ($process.ProcessName -notin $ExpectedNames) {
    return "$Label memiliki PID $processId, tetapi PID tersebut sekarang milik $($process.ProcessName)."
  }
  return ''
}

function Get-ServerHealth {
  if (-not (Test-Path -LiteralPath $processStatePath)) {
    return [pscustomobject]@{ Healthy = $false; Reason = 'State proses belum tersedia.' }
  }

  try {
    $state = Get-Content -LiteralPath $processStatePath -Raw | ConvertFrom-Json
    $checks = @(
      @{ Property = 'node_pid'; Label = 'Node.js'; Names = @('node') },
      @{ Property = 'cloudflared_pid'; Label = 'Cloudflare Tunnel'; Names = @('cloudflared') },
      @{ Property = 'backup_worker_pid'; Label = 'Backup worker'; Names = @('powershell', 'pwsh') }
    )
    foreach ($check in $checks) {
      $problem = Get-ExpectedProcessProblem -State $state -Property $check.Property `
        -Label $check.Label -ExpectedNames $check.Names
      if ($problem) { return [pscustomobject]@{ Healthy = $false; Reason = $problem } }
    }

    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
      if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        return [pscustomobject]@{ Healthy = $false; Reason = "Endpoint /health mengembalikan HTTP $($response.StatusCode)." }
      }
    } catch {
      return [pscustomobject]@{ Healthy = $false; Reason = "Endpoint /health gagal: $($_.Exception.Message)" }
    }
    return [pscustomobject]@{ Healthy = $true; Reason = 'Semua proses dan endpoint /health normal.' }
  } catch {
    return [pscustomobject]@{ Healthy = $false; Reason = "State proses tidak dapat dibaca: $($_.Exception.Message)" }
  }
}

function Stop-UnhealthyServer {
  param([Parameter(Mandatory = $true)][string]$Reason)

  if (-not (Test-Path -LiteralPath $processStatePath)) { return }
  Write-WatchdogLog "Server tidak sehat: $Reason"
  Write-WatchdogLog 'Mencoba shutdown dan backup sebelum restart.'
  Set-WatchdogStatus -State 'STOPPING' -Phase 'RECOVERY' -Detail $Reason
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
  [void](Resume-InterruptedOperation)
  $retrySeconds = $InitialRetrySeconds
  $consecutiveHealthFailures = 0
  $serverWasHealthy = $false

  while ($true) {
    $health = Get-ServerHealth
    if ($health.Healthy) {
      if (-not $serverWasHealthy) {
        Write-WatchdogLog 'Status HEALTHY: semua proses aktif dan endpoint /health lulus.'
      }
      Set-WatchdogStatus -State 'HEALTHY' -Phase 'MONITORING' -Detail $health.Reason
      $serverWasHealthy = $true
      $consecutiveHealthFailures = 0
      $retrySeconds = $InitialRetrySeconds
      Start-Sleep -Seconds $HealthCheckIntervalSeconds
      continue
    }

    if ($serverWasHealthy) {
      $consecutiveHealthFailures++
      if ($consecutiveHealthFailures -lt $HealthFailureThreshold) {
        Write-WatchdogLog "Health check gagal ($consecutiveHealthFailures/$HealthFailureThreshold): $($health.Reason)"
        Set-WatchdogStatus -State 'DEGRADED' -Phase 'HEALTH_CHECK' -Detail $health.Reason
        Start-Sleep -Seconds $HealthCheckIntervalSeconds
        continue
      }
    }

    $serverWasHealthy = $false
    $consecutiveHealthFailures = 0
    Stop-UnhealthyServer -Reason $health.Reason
    Write-WatchdogLog "Status STARTING: menjalankan server:up. Alasan: $($health.Reason)"
    Set-WatchdogStatus -State 'STARTING' -Phase 'INITIALIZE' -Detail $health.Reason
    try {
      $exitCode = Invoke-ServerScript -ScriptPath $startScript -Operation 'start'
      $healthAfterStart = Get-ServerHealth
      if ($exitCode -eq 0 -and $healthAfterStart.Healthy) {
        Write-WatchdogLog 'Status HEALTHY: server:up selesai dan health check lulus.'
        Set-WatchdogStatus -State 'HEALTHY' -Phase 'MONITORING' -Detail $healthAfterStart.Reason
        $serverWasHealthy = $true
        $retrySeconds = $InitialRetrySeconds
        continue
      }
      Write-WatchdogLog "Startup belum berhasil (exit code $exitCode): $($healthAfterStart.Reason)"
    } catch {
      Write-WatchdogLog "Startup gagal: $($_.Exception.Message)"
    }

    Write-WatchdogLog "Status RETRYING: mencoba lagi dalam $retrySeconds detik."
    Set-WatchdogStatus -State 'RETRYING' -Phase 'BACKOFF' -Detail "Retry dalam $retrySeconds detik."
    Start-Sleep -Seconds $retrySeconds
    $retrySeconds = [Math]::Min($retrySeconds * 2, $MaximumRetrySeconds)
  }
} finally {
  if ($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
