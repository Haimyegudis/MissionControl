@echo off
setlocal EnableExtensions
rem === Mission Control offline installer =================================
rem Usage: install.cmd [/norun] [/quiet]
rem   /norun  - do NOT register the login auto-start (HKCU Run key).
rem             Default is YES (auto-start enabled).
rem   /quiet  - no pause at the end (also honored via env MC_SILENT=1).
rem Env: MC_INSTALL_DIR overrides the default install location
rem      (%LOCALAPPDATA%\MissionControl). Used for testing.
rem =======================================================================

set "DEST=%LOCALAPPDATA%\MissionControl"
if defined MC_INSTALL_DIR set "DEST=%MC_INSTALL_DIR%"
set "MC_DEST=%DEST%"
set "AUTOSTART=1"
set "QUIET="
if defined MC_SILENT set "QUIET=1"
for %%A in (%*) do (
  if /i "%%~A"=="/norun" set "AUTOSTART=0"
  if /i "%%~A"=="/quiet" set "QUIET=1"
)

echo Installing Mission Control to "%DEST%" ...

rem -- stop any server still running from a previous install in DEST
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -like ($env:MC_DEST + '\*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

rem -- wipe a previous install (only if the folder looks like ours)
if exist "%DEST%\launcher\mission-control-hidden.vbs" rd /s /q "%DEST%" >nul 2>&1
if not exist "%DEST%" mkdir "%DEST%"

if exist "%~dp0app\" goto :copydir
if exist "%~dp0MissionControl.zip" goto :unzip
echo ERROR: neither an "app" folder nor MissionControl.zip was found next to install.cmd.
goto :fail

:copydir
robocopy "%~dp0app" "%DEST%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail
goto :installed

:unzip
powershell -NoProfile -Command "Expand-Archive -LiteralPath \"%~dp0MissionControl.zip\" -DestinationPath $env:MC_DEST -Force"
if errorlevel 1 goto :fail
goto :installed

:installed
rem -- Deploy bundled embedding + local-answer models. The portable CPU
rem -- Ollama runtime remains inside the app and the launcher starts it.
if not exist "%DEST%\ollama\runtime\ollama.exe" goto :afterollama
echo Installing Lumo's local AI models...
if not exist "%USERPROFILE%\.ollama\models" mkdir "%USERPROFILE%\.ollama\models"
robocopy "%DEST%\ollama\models" "%USERPROFILE%\.ollama\models" /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP >nul
rem -- free the duplicate staging models but retain the portable runtime
rd /s /q "%DEST%\ollama\models" >nul 2>&1
:afterollama

rem -- Desktop + Start Menu shortcuts
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\launcher\setup-helper.ps1" -Action shortcuts -InstallDir "%DEST%"
if errorlevel 1 goto :fail

rem -- auto-start server at login (default YES; disable with /norun)
if "%AUTOSTART%"=="1" (
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MissionControl /t REG_SZ /d "wscript.exe \"%DEST%\launcher\mission-control-hidden.vbs\" /serveronly" /f >nul
) else (
  reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MissionControl /f >nul 2>&1
)

echo.
echo Mission Control installed successfully.
echo   Location : %DEST%
echo   Shortcuts: "Mission Control" on the Desktop and in the Start Menu
if "%AUTOSTART%"=="1" (echo   Auto-start at login: ENABLED  ^(rerun with /norun to disable^)) else (echo   Auto-start at login: disabled)
echo   Uninstall: run "%DEST%\Uninstall.cmd"
echo.
if not defined QUIET pause
endlocal
exit /b 0

:fail
echo.
echo Mission Control installation FAILED.
if not defined QUIET pause
endlocal
exit /b 1
