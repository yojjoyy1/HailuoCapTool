@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Please install it from https://nodejs.org and try again.
  start "" https://nodejs.org
  pause
  exit /b
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:5173"
echo Close this window to stop the editor.
node server.js
pause
