; Mission Control — single-file offline installer (Inno Setup 6).
; Compiled by scripts\build-installer.ps1:
;   ISCC.exe /DPayloadApp="<staged payload>\app" /O"<dist-installer>" mission-control.iss
; Installs to %LOCALAPPDATA%\MissionControl (per-user, no admin), creates
; shortcuts, optional login auto-start, installs bundled Ollama + embedding
; model when present, never touches %APPDATA%\JiraWeb user data on uninstall.

#ifndef PayloadApp
  #error Pass /DPayloadApp=<path to staged payload app dir>
#endif

#define AppName "Mission Control"
#define AppVersion "1.0"

[Setup]
AppId={{B7C1E4D2-55A0-4F0E-9B7A-MC2026UNIF01}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=HP Indigo SQA
DefaultDirName={localappdata}\MissionControl
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=MissionControlSetup
Compression=lzma2/fast
SolidCompression=no
CreateAppDir=yes
DirExistsWarning=no
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\mission-control.ico
SetupIconFile=icon\mission-control.ico
WizardStyle=modern

[Tasks]
Name: "autostart"; Description: "Start the Mission Control server automatically at Windows login"
Name: "desktopicon"; Description: "Create a Desktop shortcut"

[Files]
Source: "{#PayloadApp}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userdesktop}\Mission Control"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher\mission-control-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\mission-control.ico"; Tasks: desktopicon
Name: "{userprograms}\Mission Control"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher\mission-control-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\mission-control.ico"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MissionControl"; ValueData: "wscript.exe ""{app}\launcher\mission-control-hidden.vbs"" /serveronly"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; Ollama runtime (only when bundled AND not already installed)
Filename: "{app}\ollama\OllamaSetup.exe"; Parameters: "/VERYSILENT /NORESTART /SP-"; StatusMsg: "Installing Ollama (semantic search engine)..."; Check: NeedsOllama
; Deploy the bundled embedding model into the user's Ollama store (no overwrite)
Filename: "{cmd}"; Parameters: "/c robocopy ""{app}\ollama\models"" ""%USERPROFILE%\.ollama\models"" /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP & exit /b 0"; StatusMsg: "Installing the embedding model..."; Flags: runhidden; Check: HasBundledOllama
; Drop the staging copy — the model and setup are installed now
Filename: "{cmd}"; Parameters: "/c rd /s /q ""{app}\ollama"""; Flags: runhidden; Check: HasBundledOllama
; Offer to launch at the end
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher\mission-control-hidden.vbs"""; Description: "Open Mission Control"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; Stop a running server before removing files
Filename: "{cmd}"; Parameters: "/c for /f ""tokens=5"" %p in ('netstat -ano ^| findstr :5643 ^| findstr LISTENING') do taskkill /F /PID %p"; Flags: runhidden; RunOnceId: "StopServer"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function HasBundledOllama(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\ollama\OllamaSetup.exe'));
end;

function NeedsOllama(): Boolean;
begin
  Result := HasBundledOllama()
    and (not FileExists(ExpandConstant('{localappdata}\Programs\Ollama\ollama.exe')));
end;
