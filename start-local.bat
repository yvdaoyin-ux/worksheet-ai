@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ---- Local start (with system proxy, so node can reach Gumroad) ----
REM Your system proxy port is read from Windows; default is 7890 (Clash/V2Ray).
set NODE_USE_ENV_PROXY=1
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890

echo.
echo   Starting WorksheetAI at http://localhost:3000
echo   (proxy: %HTTPS_PROXY%)
echo   Keep this window open. Press Ctrl+C to stop.
echo.

node server.js
pause
