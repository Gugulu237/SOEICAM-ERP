[CmdletBinding()]
param([string]$EnvironmentFile)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$previewUrl = 'http://localhost:5175/dev-preview'

# Reuse this project's listener; never terminate another local application.
$listeners = @(Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $listenerProcess = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess)
    if (([string]$listenerProcess.CommandLine).IndexOf($project, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'Port 5175 is in use by another application.'
    }
    Write-Output ('SOEICAM preview is already running: ' + $previewUrl)
    return
}

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $project '.env.local' }
$environmentPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$cmdPath = (Get-Command cmd.exe -ErrorAction Stop).Source
$bootstrapPath = Join-Path $project 'scripts\start-responsive-preview.mjs'
$logDirectory = Join-Path $project 'soeicam-server-logs'
$null = New-Item -ItemType Directory -Path $logDirectory -Force
$logPath = Join-Path $logDirectory 'responsive-preview.log'
foreach ($checkedPath in @($nodePath, $cmdPath, $bootstrapPath, $environmentPath, $logPath)) {
    if ($checkedPath -match '["%\r\n]') { throw 'A preview path contains unsupported shell characters.' }
}

# Windows creates this localhost-only process independently of a temporary
# terminal. No service, scheduled task, startup entry or administrator is needed.
# The Node entry disables telemetry and duplicate background manufacturing jobs.
$commandLine = '"{0}" /d /s /c ""{1}" "{2}" "{3}" >>"{4}" 2>&1"' -f $cmdPath, $nodePath, $bootstrapPath, $environmentPath, $logPath
$startup = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $project; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { throw ('Windows could not start the preview: ' + $result.ReturnValue) }
@{ processId = $result.ProcessId; url = $previewUrl; startedAt = (Get-Date).ToString('o'); log = $logPath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDirectory 'responsive-process.json') -Encoding UTF8
Write-Output ('SOEICAM preview started: ' + $previewUrl)
Write-Output ('Startup log: ' + $logPath)
