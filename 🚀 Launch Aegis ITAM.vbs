' =======================================================
'  Aegis Health ITAM - Silent Background Launcher
'  Double-click this to start the server invisibly
'  and open the browser automatically.
' =======================================================

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' Resolve the folder where this script lives
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill any existing Node.js process on port 3000 (silent)
shell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| find "":3000"" ^| find ""LISTENING"" 2^>nul') do taskkill /PID %a /F >nul 2>&1", 0, True

' Start Node.js server silently in the background
' Window style 0 = hidden, False = don't wait for it to finish
shell.Run "cmd /c cd /d """ & scriptDir & """ && node server.js > """ & scriptDir & "\server.log"" 2>&1", 0, False

' Wait 3 seconds for the server to fully initialize
WScript.Sleep 3000

' Open the system in the default browser
shell.Run "http://localhost:3000"
