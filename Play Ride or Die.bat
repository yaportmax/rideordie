@echo off
rem RIDE OR DIE launcher: builds the game and serves it on port 4173 for you and a friend (LAN / Tailscale).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :err
)
echo Building the game...
call npx vite build --logLevel warn || goto :err
set TSIP=
for /f "usebackq delims=" %%a in (`powershell -NoProfile -ExecutionPolicy Bypass -File tools\tsip.ps1`) do set TSIP=%%a
echo.
echo  ================================================================
echo   RIDE OR DIE is running.
echo   You:                http://localhost:4173
if defined TSIP echo   Friend (Tailscale): http://%TSIP%:4173
echo   One of you clicks HOST GAME and reads out the room code,
echo   the other clicks JOIN GAME and types it in.
echo   Close this window to stop the game server.
echo  ================================================================
echo.
start "" http://localhost:4173
call npx vite preview --host --port 4173 --strictPort
goto :eof
:err
echo Something went wrong - see the messages above.
pause
