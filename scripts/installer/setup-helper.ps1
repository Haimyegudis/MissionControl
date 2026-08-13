# Mission Control setup helper: shortcut creation/removal and stopping the
# installed server. Called by install.cmd / Uninstall.cmd.
param(
  [Parameter(Mandatory = $true)][ValidateSet('shortcuts', 'unshortcuts', 'stop')]
  [string]$Action,
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = 'Stop'
$linkName = 'Mission Control.lnk'
$folders = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Programs')   # Start Menu \ Programs
)

switch ($Action) {
  'shortcuts' {
    $ws = New-Object -ComObject WScript.Shell
    foreach ($f in $folders) {
      $s = $ws.CreateShortcut((Join-Path $f $linkName))
      $s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
      $s.Arguments = '"' + (Join-Path $InstallDir 'launcher\mission-control-hidden.vbs') + '"'
      $s.WorkingDirectory = $InstallDir
      $s.IconLocation = (Join-Path $InstallDir 'node\node.exe') + ',0'
      $s.Description = 'Mission Control'
      $s.Save()
    }
  }
  'unshortcuts' {
    foreach ($f in $folders) {
      Remove-Item -LiteralPath (Join-Path $f $linkName) -Force -ErrorAction SilentlyContinue
    }
  }
  'stop' {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like ($InstallDir + '\*') } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
