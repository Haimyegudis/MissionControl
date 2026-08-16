' Mission Control hidden launcher.
' Starts the bundled server with NO visible window (unless something is
' already listening on 127.0.0.1:5643) and opens the app in the default
' browser. Pass /serveronly (used by the login auto-start Run key) to start
' the server without opening a browser tab.
Option Explicit
Dim sh, fso, base, serverOnly, i, tries
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
  ' If a bundled knowledge pack exists, point the Yaki tools at it.
  If fso.FolderExists(base & "\yaki") Then
    sh.Environment("PROCESS")("YAKI_ROOT") = base & "\yaki"
  End If
  sh.Run """" & base & "\node\node.exe"" """ & base & "\server\dist\main.js""", 0, False
  ' give the server a moment to come up before opening the browser
  tries = 0
  Do While tries < 20 And Not IsListening()
    WScript.Sleep 250
    tries = tries + 1
  Loop
End If

If Not serverOnly Then sh.Run "http://127.0.0.1:5643/", 1, False

Function IsListening()
  IsListening = (sh.Run("cmd /c netstat -an -p tcp | findstr /r /c:"":5643 .*LISTENING"" >nul 2>&1", 0, True) = 0)
End Function
