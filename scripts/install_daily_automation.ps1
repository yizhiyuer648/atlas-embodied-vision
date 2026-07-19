[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$CodexHome,
    [string]$Model = 'gpt-5.6-sol',
    [string]$AutomationId = 'atlas-portable-daily'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$promptPath = Join-Path $ProjectRoot '.codex\portable-automation-prompt.txt'

if (-not (Test-Path (Join-Path $ProjectRoot 'README.md'))) {
    throw "README.md was not found in the project directory: $ProjectRoot"
}
if (-not (Test-Path $promptPath)) {
    throw "The portable automation prompt is missing: $promptPath"
}
if (-not (Test-Path $CodexHome)) {
    throw "Codex home was not found: $CodexHome. Install, sign in, and launch Codex Desktop once before retrying."
}

function Convert-ToTomlString([string]$Value) {
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    $escaped = $escaped.Replace("`r", '').Replace("`n", '\n')
    return '"' + $escaped + '"'
}

$prompt = [IO.File]::ReadAllText($promptPath, [Text.Encoding]::UTF8).Replace('{{PROJECT_ROOT}}', $ProjectRoot)
$automationName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('QXRsYXMg5q+P5pel5a6M5pW05LyY5YyW5b6q546v77yI5Y+v6L+B56e777yJ'))
$automationDir = Join-Path $CodexHome ("automations\" + $AutomationId)
$automationFile = Join-Path $automationDir 'automation.toml'
New-Item -ItemType Directory -Force -Path $automationDir | Out-Null

if (Test-Path $automationFile) {
    $backup = "$automationFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $automationFile -Destination $backup
    Write-Host "Existing automation backed up to: $backup"
}

$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$toml = @(
    'version = 1'
    "id = $(Convert-ToTomlString $AutomationId)"
    'kind = "cron"'
    "name = $(Convert-ToTomlString $automationName)"
    "prompt = $(Convert-ToTomlString $prompt)"
    'status = "ACTIVE"'
    'rrule = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0"'
    "model = $(Convert-ToTomlString $Model)"
    'reasoning_effort = "ultra"'
    'execution_environment = "local"'
    ('target = { type = "project", project_id = ' + (Convert-ToTomlString $ProjectRoot) + ' }')
    ('cwds = [' + (Convert-ToTomlString $ProjectRoot) + ']')
    "created_at = $now"
    "updated_at = $now"
) -join "`n"

[IO.File]::WriteAllText($automationFile, $toml + "`n", [Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host 'The Atlas daily optimization automation is installed.'
Write-Host "Automation file: $automationFile"
Write-Host 'Schedule: 09:00 local time every day; the computer and Codex must be available.'
Write-Host 'Fully quit and reopen Codex Desktop, then confirm that the automation is enabled.'
Write-Host 'If this account cannot use the requested model, select an available model in Codex.'
