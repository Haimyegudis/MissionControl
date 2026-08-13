@echo off
rem Mission Control launcher: starts the server hidden (if it is not already
rem running) and opens http://127.0.0.1:5643 in the default browser.
start "" wscript.exe "%~dp0mission-control-hidden.vbs"
