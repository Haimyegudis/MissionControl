' Mission Control hidden launcher.
' Starts the bundled server with NO visible window (unless something is
' already listening on 127.0.0.1:5643) and opens the app in the default
' browser. Pass /serveronly (used by the login auto-start Run key) to start
' the server without opening a browser tab.
Option Explicit
Dim sh, fso, base, serverOnly, i, tries, tokenFile, token, appUrl, stream
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' this script lives in <install>\launcher\ -> base is the install dir
base = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

serverOnly = False
For i = 0 To WScript.Arguments.Count - 1
  If LCase(WScript.Arguments(i)) = "/serveronly" Then serverOnly = True
Next

If Not IsListening() Then
  sh.CurrentDirectory = base
  ' If a bundled knowledge pack exists, point the Lumo tools at it.
  If fso.FolderExists(base & "\lumo") Then
    sh.Environment("PROCESS")("LUMO_ROOT") = base & "\lumo"
  End If
  ' Start the bundled CPU Ollama runtime only when no system Ollama service
  ' is already listening. It provides offline embeddings and local answers.
  If fso.FileExists(base & "\ollama\runtime\ollama.exe") And Not IsOllamaListening() Then
    sh.Run """" & base & "\ollama\runtime\ollama.exe"" serve", 0, False
  End If
  sh.Run """" & base & "\node\node.exe"" """ & base & "\server\dist\main.js""", 0, False
  ' give the server a moment to come up before opening the browser
  tries = 0
  Do While tries < 20 And Not IsListening()
    WScript.Sleep 250
    tries = tries + 1
  Loop
End If

If Not serverOnly Then
  token = ""
  tokenFile = sh.ExpandEnvironmentStrings("%APPDATA%") & "\JiraWeb\api-token"
  If fso.FileExists(tokenFile) Then
    Set stream = fso.OpenTextFile(tokenFile, 1, False)
    token = Trim(stream.ReadAll)
    stream.Close
  End If
  appUrl = "http://127.0.0.1:5643/#/dashboard"
  If Len(token) > 0 Then appUrl = appUrl & "?mc_token=" & token
  sh.Run appUrl, 1, False
End If

Function IsListening()
  IsListening = (sh.Run("cmd /c netstat -an -p tcp | findstr /r /c:"":5643 .*LISTENING"" >nul 2>&1", 0, True) = 0)
End Function

Function IsOllamaListening()
  IsOllamaListening = (sh.Run("cmd /c netstat -an -p tcp | findstr /r /c:"":11434 .*LISTENING"" >nul 2>&1", 0, True) = 0)
End Function
