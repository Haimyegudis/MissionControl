#Requires -Version 5.1
<#
Builds a ONE-CLICK OFFLINE Windows installer for Mission Control (JiraWeb).

Preferred output: dist-installer\MissionControlSetup.exe (Inno Setup 6,
        single-file, per-user one-click installer).
Fallback when Inno Setup is unavailable: dist-installer\MissionControlSetup.cmd
        + dist-installer\MissionControl.zip (run the .cmd; still one click).

Payload (staged to build\installer\payload\):
  install.cmd            installer entry point ([/norun] [/quiet], MC_INSTALL_DIR env override)
  app\node\node.exe      bundled Node.js runtime (copied from this machine)
  app\server\dist        compiled server (no .ts sources)
  app\server\package.json
  app\server\node_modules  PRUNED production closure (scripts\collect-prod-deps.mjs)
  app\client\dist        built web client
  app\launcher\*         MissionControl.cmd, mission-control-hidden.vbs, setup-helper.ps1
  app\Uninstall.cmd, app\README.txt

Usage: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 [-SkipAppBuild] [-SkipExe] [-StageOnly]
#>
[CmdletBinding()]
param(
  [switch]$IncludeKnowledge, # compatibility switch; Lumo knowledge is now always bundled
  [switch]$SkipAppBuild,  # reuse existing client/dist + server/dist
  [switch]$SkipExe,       # skip IExpress; emit the cmd+zip pair only
  [switch]$StageOnly      # validate/stage the complete payload without compressing it
)

$ErrorActionPreference = 'Stop'
$IncludeKnowledge = $true # Mission Control is self-contained; knowledge is not optional.
$Root    = Split-Path -Parent $PSScriptRoot
$Stage   = Join-Path $Root 'build\installer'
$Payload = Join-Path $Stage 'payload'
$App     = Join-Path $Payload 'app'
$Out     = Join-Path $Root 'dist-installer'
$Assets  = Join-Path $PSScriptRoot 'installer'

# ---------------------------------------------------------------------------
# EXPLICIT EXCLUSION LIST - files that must NEVER end up in the payload.
# The build FAILS if any file matching these names is found after staging.
# ---------------------------------------------------------------------------
$ForbiddenNames = @(
  '.env', '.env.*',            # env files anywhere
  'config.json',               # runtime config (may hold credentials)
  'credentials*',              # credential stores, any extension
  '*.db', '*.sqlite', '*.sqlite3',  # databases
  '*.pem', '*.key', '*.pfx', 'id_rsa*'  # key material
)
# Also never staged at all (by construction): docs\, .git\, server\src,
# client\src, tests, %APPDATA%\JiraWeb data. Only compiled dist ships.
#
# Provenance exception: the app's compiled module credentialsStore.js (built
# by tsc from server\src\config\credentialsStore.ts) matches "credentials*"
# by NAME but is application code, not a secrets file. A payload file that
# matches a forbidden pattern is tolerated ONLY when it sits under
# app\server\dist and is byte-identical to the same file in server\dist that
# this build just compiled. Everything else still fails the build.
function Test-IsCompiledAppFile([System.IO.FileInfo]$File, [string]$PayloadRoot, [string]$RepoRoot) {
  $rel = $File.FullName.Substring($PayloadRoot.Length + 1)
  if ($rel -notlike 'app\server\dist\*') { return $false }
  $srcPeer = Join-Path $RepoRoot ('server\dist\' + $rel.Substring('app\server\dist\'.Length))
  if (-not (Test-Path -LiteralPath $srcPeer)) { return $false }
  $a = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
  $b = (Get-FileHash -LiteralPath $srcPeer -Algorithm SHA256).Hash
  return $a -eq $b
}

function Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail([string]$msg) { Write-Host "BUILD FAILED: $msg" -ForegroundColor Red; exit 1 }

# --- 1. build client + server ----------------------------------------------
if (-not $SkipAppBuild) {
  Step 'npm run build (client + server)'
  Push-Location $Root
  try {
    cmd /c 'npm run build'
    if ($LASTEXITCODE -ne 0) { Fail "npm run build exited with $LASTEXITCODE" }
  } finally { Pop-Location }
} else {
  Step 'Skipping app build (reusing existing dist folders)'
}
if (-not (Test-Path (Join-Path $Root 'server\dist\main.js'))) { Fail 'server\dist\main.js missing' }
if (-not (Test-Path (Join-Path $Root 'client\dist\index.html'))) { Fail 'client\dist\index.html missing' }

# --- 2. stage payload -------------------------------------------------------
Step "Staging payload -> $Payload"
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $App | Out-Null

Copy-Item (Join-Path $Root 'server\dist')  (Join-Path $App 'server\dist')  -Recurse
Copy-Item (Join-Path $Root 'server\package.json') (Join-Path $App 'server\package.json')
Copy-Item (Join-Path $Root 'client\dist')  (Join-Path $App 'client\dist')  -Recurse

# bundled Node runtime
$nodeExe = (Get-Command node.exe).Source
Step "Bundling Node runtime: $nodeExe ($([Math]::Round((Get-Item $nodeExe).Length/1MB,1)) MB)"
New-Item -ItemType Directory -Force -Path (Join-Path $App 'node') | Out-Null
Copy-Item $nodeExe (Join-Path $App 'node\node.exe')

# pruned production node_modules (transitive closure of server deps)
Step 'Collecting production node_modules (pruned transitive closure)'
& node (Join-Path $PSScriptRoot 'collect-prod-deps.mjs') $Root (Join-Path $App 'server\node_modules')
if ($LASTEXITCODE -ne 0) { Fail "collect-prod-deps.mjs exited with $LASTEXITCODE" }

# launcher + installer/uninstaller assets
New-Item -ItemType Directory -Force -Path (Join-Path $App 'launcher') | Out-Null
Copy-Item (Join-Path $Assets 'MissionControl.cmd')          (Join-Path $App 'launcher\')
Copy-Item (Join-Path $Assets 'mission-control-hidden.vbs')  (Join-Path $App 'launcher\')
Copy-Item (Join-Path $Assets 'setup-helper.ps1')            (Join-Path $App 'launcher\')
Copy-Item (Join-Path $Assets 'Uninstall.cmd')               (Join-Path $App 'Uninstall.cmd')
Copy-Item (Join-Path $Assets 'README.txt')                  (Join-Path $App 'README.txt')
Copy-Item (Join-Path $Assets 'icon\mission-control.ico')    (Join-Path $App 'mission-control.ico')
Copy-Item (Join-Path $Assets 'install.cmd')                 (Join-Path $Payload 'install.cmd')

# Mandatory self-contained Lumo knowledge pack (no credentials or .env files).
if ($IncludeKnowledge) {
  $LumoRoot = Join-Path $Root 'lumo'
  if (-not (Test-Path -LiteralPath $LumoRoot)) { Fail "Bundled Lumo root missing: $LumoRoot" }
  Step "Bundling knowledge pack from $LumoRoot (this is ~2GB)"
  $KDb = Join-Path $App 'lumo\DB'
  $KData = Join-Path $App 'lumo\data'
  New-Item -ItemType Directory -Force -Path $KDb, (Join-Path $KData 'brain') | Out-Null
  Copy-Item (Join-Path $LumoRoot 'DB\*.db')  $KDb -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $LumoRoot 'data\*') $KData -Recurse -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $LumoRoot 'config') (Join-Path $App 'lumo\config') -Recurse -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $LumoRoot 'manifest.json') (Join-Path $App 'lumo\manifest.json')
  Copy-Item (Join-Path $LumoRoot 'README.md') (Join-Path $App 'lumo\README.md')
  $kCount = (Get-ChildItem $KDb, $KData -Recurse -File | Measure-Object).Count
  if ($kCount -lt 5) { Fail "Knowledge pack looks empty ($kCount files) - is $LumoRoot present?" }
  Step "Knowledge pack staged: $kCount files"

  # Portable CPU Ollama runtime + embedding and local-answer models for
  # fully-offline Lumo. The official 1.5GB bootstrapper would push this
  # knowledge package beyond Windows' single-EXE limit.
  Step 'Bundling Ollama + Lumo embedding and answer models'
  $ODir = Join-Path $App 'ollama'
  $ORuntime = Join-Path $ODir 'runtime'
  $OllamaInstalled = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
  $OllamaExe = Join-Path $OllamaInstalled 'ollama.exe'
  $OllamaLib = Join-Path $OllamaInstalled 'lib\ollama'
  if (-not (Test-Path -LiteralPath $OllamaExe)) { Fail "Portable Ollama source missing: $OllamaExe" }
  if (-not (Test-Path -LiteralPath $OllamaLib)) { Fail "Portable Ollama libraries missing: $OllamaLib" }
  New-Item -ItemType Directory -Force -Path (Join-Path $ORuntime 'lib\ollama') | Out-Null
  Copy-Item -LiteralPath $OllamaExe -Destination $ORuntime
  Get-ChildItem -LiteralPath $OllamaLib -File | Copy-Item -Destination (Join-Path $ORuntime 'lib\ollama')
  $runtimeSize = (Get-ChildItem -LiteralPath $ORuntime -Recurse -File | Measure-Object Length -Sum).Sum
  if ($runtimeSize -lt 50MB) { Fail "Portable Ollama runtime looks incomplete ($runtimeSize bytes)" }

  $ModelSrc = Join-Path $env:USERPROFILE '.ollama\models'
  $Models = @(
    @{ Family = 'mxbai-embed-large'; Tag = '335m' },
    @{ Family = 'gemma3'; Tag = '1b' }
  )
  $allDigests = @{}
  New-Item -ItemType Directory -Force -Path (Join-Path $ODir 'models\blobs') | Out-Null
  foreach ($model in $Models) {
    $modelName = "$($model.Family):$($model.Tag)"
    $manifest = Join-Path $ModelSrc "manifests\registry.ollama.ai\library\$($model.Family)\$($model.Tag)"
    if (-not (Test-Path $manifest)) { Fail "$modelName manifest not found at $manifest (run: ollama pull $modelName)" }
    $manDest = Join-Path $ODir "models\manifests\registry.ollama.ai\library\$($model.Family)"
    New-Item -ItemType Directory -Force -Path $manDest | Out-Null
    Copy-Item $manifest (Join-Path $manDest $model.Tag)
    $mj = Get-Content $manifest -Raw | ConvertFrom-Json
    $digests = @($mj.config.digest) + ($mj.layers | ForEach-Object { $_.digest })
    foreach ($d in $digests) { $allDigests[$d] = $true }
  }
  foreach ($d in $allDigests.Keys) {
    $blob = Join-Path $ModelSrc ('blobs\' + ($d -replace ':', '-'))
    if (-not (Test-Path $blob)) { Fail "Model blob missing: $blob" }
    Copy-Item $blob (Join-Path $ODir 'models\blobs\')
  }
  Step ("Ollama bundled: {0}MB portable CPU runtime + {1} models ({2} unique blobs)" -f [Math]::Round($runtimeSize / 1MB, 1), $Models.Count, $allDigests.Count)
}

# --- 3. verify: no secrets / no sources in payload --------------------------
Step 'Verifying payload contains no secrets'
$allFiles = Get-ChildItem -LiteralPath $Payload -Recurse -Force -File
$nameMatches = $allFiles | Where-Object {
  $n = $_.Name
  ($ForbiddenNames | Where-Object { $n -like $_ }).Count -gt 0
}
$knowledgeDir = Join-Path $App 'lumo'
$hits = @()
foreach ($m in $nameMatches) {
  if ($IncludeKnowledge -and $m.FullName.StartsWith($knowledgeDir, [System.StringComparison]::OrdinalIgnoreCase) -and (@('.db', '.db-wal', '.db-shm') -contains $m.Extension)) {
    # Knowledge-pack vector DBs are data, not secrets (only *.db under app\lumo).
    continue
  }
  if (Test-IsCompiledAppFile -File $m -PayloadRoot $Payload -RepoRoot $Root) {
    Write-Host "  tolerated (verified compiled app module, hash-matched to server\dist): $($m.FullName)"
  } else {
    $hits += $m
  }
}
if ($hits.Count -gt 0) {
  $hits | ForEach-Object { Write-Host "  FORBIDDEN FILE IN PAYLOAD: $($_.FullName)" -ForegroundColor Red }
  Fail "$($hits.Count) forbidden file(s) found in payload"
}
Write-Host "  OK: 0 secret files matching [$($ForbiddenNames -join ', ')] across $($allFiles.Count) files"

$tsHits = $allFiles | Where-Object {
  $_.Extension -eq '.ts' -and $_.Name -notlike '*.d.ts' -and $_.FullName -notmatch '\\node_modules\\'
}
if ($tsHits) {
  $tsHits | ForEach-Object { Write-Host "  TS SOURCE IN PAYLOAD: $($_.FullName)" -ForegroundColor Red }
  Fail 'TypeScript sources found in payload (only compiled dist may ship)'
}
Write-Host '  OK: no .ts sources outside node_modules'

$addon = Join-Path $App 'server\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
if (-not (Test-Path $addon)) { Fail 'better_sqlite3.node native addon missing from payload' }
Write-Host "  OK: native addon present ($addon)"

if ($StageOnly) {
  Step 'Stage-only build complete'
  Write-Host "Validated payload: $Payload"
  exit 0
}

# --- 4a. preferred: single-file installer via Inno Setup 6 -------------------
$iscc = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
  Step "Building single-file MissionControlSetup.exe with Inno Setup ($iscc)"
  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  foreach ($stale in 'MissionControlSetup.exe', 'MissionControlSetup.cmd', 'MissionControl.zip', 'install.cmd') {
    $p = Join-Path $Out $stale
    if (Test-Path $p) { Remove-Item $p -Force }
  }
  & $iscc "/DPayloadApp=$App" "/O$Out" (Join-Path $Assets 'mission-control.iss') | Select-Object -Last 4
  if ($LASTEXITCODE -ne 0) { Fail "ISCC exited with $LASTEXITCODE" }
  $innoExe = Join-Path $Out 'MissionControlSetup.exe'
  if (-not (Test-Path $innoExe)) { Fail 'Inno build reported success but exe is missing' }
  Step 'Done'
  Write-Host ("Artifact: {0} ({1} MB)" -f $innoExe, [Math]::Round((Get-Item $innoExe).Length / 1MB, 1))
  Write-Host "Staged payload: $Payload"
  exit 0
}

# --- 4. zip the app (fallback when Inno Setup is unavailable) ----------------
Step 'Zipping payload (MissionControl.zip)'
$zip = Join-Path $Stage 'MissionControl.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $App '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "  $zip ($([Math]::Round((Get-Item $zip).Length/1MB,1)) MB)"
Copy-Item (Join-Path $Payload 'install.cmd') (Join-Path $Stage 'install.cmd') -Force

# --- 5. wrap into a single Setup EXE with IExpress --------------------------
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$exe = Join-Path $Out 'MissionControlSetup.exe'
foreach ($stale in @($exe, 'MissionControlSetup.cmd', 'MissionControl.zip', 'install.cmd')) {
  $p = if ([System.IO.Path]::IsPathRooted($stale)) { $stale } else { Join-Path $Out $stale }
  if (Test-Path $p) { Remove-Item $p -Force }
}
$exeOk = $false

# IExpress CAB tops out around 2GB; a knowledge+Ollama payload exceeds it, so
# full builds always ship the cmd+zip pair instead of a single exe.
if ($IncludeKnowledge -and -not $SkipExe) {
  $zipMB = [Math]::Round((Get-Item $zip).Length / 1MB)
  if ($zipMB -gt 1500) {
    Step "Payload zip is $zipMB MB - skipping IExpress (CAB limit), emitting cmd+zip pair"
    $SkipExe = $true
  }
}

if (-not $SkipExe) {
  Step 'Building MissionControlSetup.exe with IExpress'
  $sed = Join-Path $Stage 'MissionControlSetup.sed'
  @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Mission Control Setup
AppLaunched=cmd /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=cmd /c install.cmd /quiet
UserQuietInstCmd=cmd /c install.cmd /quiet
FILE0="install.cmd"
FILE1="MissionControl.zip"
[SourceFiles]
SourceFiles0=$Stage\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@ | Set-Content -LiteralPath $sed -Encoding ASCII

  $iexpress = Join-Path $env:WINDIR 'System32\iexpress.exe'
  if (Test-Path $iexpress) {
    $p = Start-Process -FilePath $iexpress -ArgumentList '/N', '/Q', $sed -Wait -PassThru -WindowStyle Hidden
    Write-Host "  iexpress exit code: $($p.ExitCode)"
    if (Test-Path $exe) { $exeOk = $true }
    else { Write-Host '  IExpress produced no exe; falling back to cmd+zip pair' -ForegroundColor Yellow }
  } else {
    Write-Host '  iexpress.exe not found; falling back to cmd+zip pair' -ForegroundColor Yellow
  }
}

if (-not $exeOk) {
  Step 'Emitting fallback pair: MissionControlSetup.cmd + MissionControl.zip'
  Copy-Item $zip (Join-Path $Out 'MissionControl.zip') -Force
  Copy-Item (Join-Path $Payload 'install.cmd') (Join-Path $Out 'install.cmd') -Force
  # install.cmd already supports a MissionControl.zip sitting next to it, so
  # the fallback setup just delegates to it from this directory.
  @'
@echo off
rem Mission Control one-click setup (fallback). Keep MissionControl.zip and
rem install.cmd next to this file, then double-click this file.
call "%~dp0install.cmd" %*
'@ | Set-Content -LiteralPath (Join-Path $Out 'MissionControlSetup.cmd') -Encoding ASCII
}

# --- 6. report --------------------------------------------------------------
Step 'Done'
if ($exeOk) {
  Write-Host ("Artifact: {0} ({1} MB)" -f $exe, [Math]::Round((Get-Item $exe).Length/1MB, 1))
} else {
  Write-Host "Artifacts: $(Join-Path $Out 'MissionControlSetup.cmd') + MissionControl.zip + install.cmd"
}
Write-Host "Staged payload: $Payload"
