[CmdletBinding()]
param([string]$EnvironmentFile)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $project '.env.local' }
$environmentPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
$projectPattern = [regex]::Escape($project) + '[\\/]'

# Preflight every listener before stopping anything. Other applications are never stopped.
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 5175)
$targets = @{}
foreach ($listener in $listeners) {
    $candidate = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess) -ErrorAction Stop
    if (-not $candidate -or $candidate.Name -ne 'node.exe' -or ([string]$candidate.CommandLine) -notmatch $projectPattern) {
        throw 'Port 5175 belongs to another application. The restart was cancelled.'
    }
    $targets[[int]$candidate.ProcessId] = $candidate
    # Include only this checkout's Node parents, so the dev launcher cannot respawn the listener.
    for ($depth = 0; $depth -lt 4; $depth++) {
        $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $candidate.ParentProcessId) -ErrorAction Stop
        if (-not $parent -or $parent.Name -ne 'node.exe' -or ([string]$parent.CommandLine) -notmatch $projectPattern) { break }
        $targets[[int]$parent.ProcessId] = $parent
        $candidate = $parent
    }
}
foreach ($target in @($targets.Values | Sort-Object CreationDate)) {
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $target.ProcessId) -ErrorAction Stop
    if (-not $current) { continue }
    if ($current.CreationDate -ne $target.CreationDate -or $current.CommandLine -ne $target.CommandLine) {
        throw 'A process changed during the restart. No further process was stopped.'
    }
    Stop-Process -Id $current.ProcessId -ErrorAction Stop
}
$deadline = (Get-Date).AddSeconds(10)
do {
    $remaining = @(Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($remaining.Count -gt 0) { throw 'The preview port is still occupied. Startup was cancelled.' }

& (Join-Path $PSScriptRoot 'start-local-preview.ps1') -EnvironmentFile $environmentPath
