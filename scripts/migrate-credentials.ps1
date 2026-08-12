# Migrates Jira credentials from Mission Control (WPF) to JiraWeb.
# Decrypts %APPDATA%\MissionControl\credentials.dat (DPAPI, CurrentUser)
# and writes %APPDATA%\JiraWeb\config.json. Run it yourself:
#   powershell -ExecutionPolicy Bypass -File C:\APPS\JiraWeb\scripts\migrate-credentials.ps1

$vault = Join-Path $env:APPDATA 'MissionControl\credentials.dat'
if (-not (Test-Path $vault)) { Write-Host 'Old vault not found — nothing to migrate.'; exit 1 }

Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('MissionControl.v1')
$blob = [IO.File]::ReadAllBytes($vault)
$json = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $entropy, 'CurrentUser'))
$c = $json | ConvertFrom-Json

$out = [ordered]@{
  email             = $c.Email
  jiraBaseUrl       = $c.JiraBaseUrl
  jiraPat           = $c.JiraPat
  instanceType      = 'datacenter'
  defaultProjectKey = 'ISW'
}
$dir = Join-Path $env:APPDATA 'JiraWeb'
New-Item -ItemType Directory -Force $dir | Out-Null
$out | ConvertTo-Json | Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8
Write-Host ("Migrated credentials for {0} ({1}). PAT length: {2}." -f $c.Email, $c.JiraBaseUrl, $c.JiraPat.Length)
Write-Host 'Restart the JiraWeb server (or refresh the page) to sign in automatically.'
