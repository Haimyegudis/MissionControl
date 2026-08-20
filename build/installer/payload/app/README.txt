Mission Control
===============

A local Jira/TestRail/Confluence mission-control app. The bundled server
listens only on http://127.0.0.1:5643 and uses the Node.js runtime shipped in
this folder. Installation downloads nothing. Lumo can answer locally through
the bundled Ollama runtime; live work-system and external-AI features contact
their configured services only when you connect/enable them.

Starting the app
----------------
Use the "Mission Control" shortcut on the Desktop or in the Start Menu.
It starts the server hidden (only if it is not already running) and opens
http://127.0.0.1:5643 in your default browser.

Manual start: launcher\MissionControl.cmd

Auto-start at login
-------------------
By default the installer registers a login auto-start entry
(HKCU\Software\Microsoft\Windows\CurrentVersion\Run -> "MissionControl")
that starts the server hidden, without opening a browser. To install without
it, run the installer's install.cmd with the /norun flag.

Your data
---------
All settings, credentials and the local database live in %APPDATA%\JiraWeb
(created on first run). This folder is yours and is never touched by the
installer or the uninstaller.

Uninstalling
------------
Run Uninstall.cmd in this folder. It removes the install folder, the
Desktop/Start Menu shortcuts and the login auto-start entry.
It does NOT remove your user data in %APPDATA%\JiraWeb — delete that folder
yourself if you also want your settings/database gone.

Folder layout
-------------
  node\           bundled Node.js runtime (node.exe)
  server\         compiled server (dist) + production node_modules
  client\dist\    built web client (served statically by the server)
  lumo\           self-contained knowledge databases and brain files
  ollama\runtime\ portable CPU runtime for offline embeddings/local answers
  launcher\       MissionControl.cmd + hidden launcher scripts
  Uninstall.cmd   uninstaller
