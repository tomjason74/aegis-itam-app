' =======================================================
'  Aegis Health ITAM - Silent Server Stop
'  Double-click this to stop the background server.
' =======================================================

Set shell = CreateObject("WScript.Shell")

' Kill any Node.js process listening on port 3000 (silent)
shell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| find "":3000"" ^| find ""LISTENING"" 2^>nul') do taskkill /PID %a /F >nul 2>&1", 0, True
