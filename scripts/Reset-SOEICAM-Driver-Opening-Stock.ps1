[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$ReviewOpeningAccounts,
    [string]$EnvironmentFile,
    [string]$OpeningOffsetAccountId,
    [string]$Actor = 'Gugulu - SOEICAM project owner',
    [string]$BackupRoot = (Join-Path $env:USERPROFILE 'SOEICAM-Private-Backups')
)
$ErrorActionPreference = 'Stop'
if ($OpeningOffsetAccountId) { throw 'Account selection has been replaced by the reviewed opening-baseline clearing account. Run without -OpeningOffsetAccountId.' }
if ($Apply -and $ReviewOpeningAccounts) { throw 'Opening-account review is read-only. Do not combine -ReviewOpeningAccounts with -Apply.' }
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$entry = Join-Path $PSScriptRoot 'reset-driver-opening-stock.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $EnvironmentFile) {
    $localEnvironment = Join-Path $project '.env.local'
    $settingsPath = Join-Path $project 'soeicam-server-logs\preview-settings.json'
    $originalEnvironment = Join-Path $env:USERPROFILE 'Documents\Codex\2026-10-17\new-chat-3\SOEICAM-ERP\.env.local'
    if (Test-Path -LiteralPath $localEnvironment -PathType Leaf) {
        $EnvironmentFile = $localEnvironment
    } elseif (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        $EnvironmentFile = [string]$settings.environmentFile
    } elseif (Test-Path -LiteralPath $originalEnvironment -PathType Leaf) {
        $EnvironmentFile = $originalEnvironment
    }
}
if (-not $EnvironmentFile -or -not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw 'Pass -EnvironmentFile with the existing SOEICAM .env.local path.'
}
$environmentPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
Push-Location -LiteralPath $project
try {
    $reviewArguments = @("--env-file=$environmentPath", $entry)
    if ($ReviewOpeningAccounts) { $reviewArguments += '--review-opening-accounts' }
    $rawPreview = & $node @reviewArguments
    if ($LASTEXITCODE -ne 0) { throw 'The read-only review failed. No reset was started.' }
    $review = ($rawPreview -join [Environment]::NewLine) | ConvertFrom-Json
    if ($ReviewOpeningAccounts) {
        if (-not $review.opening_account_review) { throw 'The read-only account report is missing. No reset was started.' }
        Write-Output ($review.opening_account_review | ConvertTo-Json -Depth 12)
        if (@($review.blockers).Count -gt 0) { Write-Output ($review.blockers -join [Environment]::NewLine) }
        return
    }
    if ($review.completed) {
        Write-Output 'This driver opening cutover was already completed. No later stock was changed.'
        Write-Output ($review.receipt | ConvertTo-Json -Depth 12)
        return
    }
    Write-Output ($review.summary | ConvertTo-Json -Depth 12)
    if ($review.summary.correction.required) {
        Write-Output ('Opening baseline correction: {0:N2} XAF through {1}. Existing warehouse counts include returned unsold goods and will stay unchanged.' -f [decimal]$review.summary.correction.total, $review.summary.correction.offset_account)
        Write-Output 'This temporary clearing balance requires reconciliation with the full opening accounts. No new sale, operating expense, customer debt, supplier debt or warehouse return will be recorded.'
    }
    if (-not $review.eligible) {
        Write-Output ($review.blockers -join [Environment]::NewLine)
        throw 'The cutover is blocked by the checks shown above. No records were changed.'
    }
    if (-not $Apply) {
        Write-Output 'Read-only review complete. To execute this reviewed one-time cutover, run the same command with -Apply.'
        return
    }
    $null = New-Item -ItemType Directory -Path $BackupRoot -Force
    $backupParent = (Resolve-Path -LiteralPath $BackupRoot).Path
    $backupDirectory = Join-Path $backupParent ('driver-opening-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    $applyArguments = @("--env-file=$environmentPath", $entry, '--apply', '--target', [string]$review.target, '--snapshot', [string]$review.snapshot, '--review', [string]$review.reviewHash, '--backup-dir', $backupDirectory, '--actor', $Actor)
    $rawResult = & $node @applyArguments
    if ($LASTEXITCODE -ne 0) { throw 'Cutover not confirmed. Keep the output and retry the same command to check its one-time marker; do not issue new stock until confirmed.' }
    $result = ($rawResult -join [Environment]::NewLine) | ConvertFrom-Json
    Write-Output ($result | ConvertTo-Json -Depth 12)
    if ($result.mode -eq 'cutover committed' -or $result.reused) {
        Write-Output 'Driver opening baseline confirmed. Warehouse counts, customer and supplier balances, and historical journals are preserved. New stock may now be issued through Inventory > Issue goods. Reconcile any temporary opening-clearing balance as part of the full opening accounts.'
    } else {
        Write-Output 'No old driver allocations needed resetting.'
    }
} finally {
    Pop-Location
}
