@echo off
setlocal EnableExtensions
rem === Mission Control uninstaller =======================================
rem Removes: install folder, Desktop + Start Menu shortcuts, login Run key.
rem Does NOT touch your user data in %APPDATA%\JiraWeb.
rem =======================================================================
set "DEST=%~dp0"
if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"
echo Uninstalling Mission Control from "%DEST%" ...

rem -- remove login auto-start
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MissionControl /f >nul 2>&1

rem -- stop the running server (if any) and remove shortcuts
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\launcher\setup-helper.ps1" -Action stop -InstallDir "%DEST%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\launcher\setup-helper.ps1" -Action unshortcuts -InstallDir "%DEST%" >nul 2>&1

rem -- delete the install folder (delayed, so this script can finish first)
cd /d "%TEMP%"
start "" /min cmd /c "timeout /t 2 /nobreak >nul & rd /s /q ""%DEST%"""
echo Done. Your data in %APPDATA%\JiraWeb was NOT removed.
endlocal
exit /b 0
