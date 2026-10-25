[CmdletBinding()]
param([string]$EnvironmentFile)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $EnvironmentFile) {
    $localEnvironment = Join-Path $project '.env.local'
    $settingsFile = Join-Path $project 'soeicam-server-logs\preview-settings.json'
    if (Test-Path -LiteralPath $localEnvironment -PathType Leaf) {
        $EnvironmentFile = $localEnvironment
    } elseif (Test-Path -LiteralPath $settingsFile -PathType Leaf) {
        $settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
        $EnvironmentFile = [string]$settings.environmentFile
    }
}
if (-not $EnvironmentFile -or -not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw 'Pass -EnvironmentFile with the full path to the existing SOEICAM .env.local file.'
}
$environmentPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$bootstrapPath = Join-Path $project 'scripts\start-responsive-preview.mjs'
$env:POWERSHELL_TELEMETRY_OPTOUT = '1'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:CLERK_TELEMETRY_DISABLED = '1'
Set-Location -LiteralPath $project
Write-Host 'Starting SOEICAM ERP: http://localhost:5175' -ForegroundColor Green
Write-Host 'Keep this console open while using the app. Press Ctrl+C to stop it.'
& $nodePath $bootstrapPath $environmentPath
if ($LASTEXITCODE -ne 0) { throw 'SOEICAM stopped. Review the server message above.' }
