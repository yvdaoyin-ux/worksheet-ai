@echo off
title WorksheetAI - push to GitHub
setlocal enabledelayedexpansion
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
set "GIT=C:\Program Files\Git\cmd\git.exe"
set "LOG=C:\Users\fa'r\Desktop\push-log.txt"

echo ============================================================
echo    WorksheetAI   --   push to GitHub
echo ============================================================
echo    Repo : %REPO%
echo    Log  : %LOG%
echo ============================================================
echo.

rem --- SAFETY ----------------------------------------------------------------
rem Backups contain a full .git, so running this inside a backup copy pushes an
rem OLD commit and silently rolls the live site back. (This really happened.)
echo %REPO% | find /i "backup" >nul
if not errorlevel 1 (
  echo    *** WRONG FOLDER - STOPPING ***
  echo.
  echo    This is a BACKUP copy, not the working project.
  echo    Pushing from here would overwrite the live site with an old version.
  echo.
  echo    Use the push script sitting on your Desktop instead.
  echo.
  goto hold
)

if not exist "%REPO%\.git" (
  echo    ERROR: not a git repository: %REPO%
  goto hold
)

if not exist "%GIT%" set "GIT=git"
"%GIT%" --version >nul 2>&1
if errorlevel 1 (
  echo    ERROR: git not found at C:\Program Files\Git\cmd\git.exe
  goto hold
)

cd /d "%REPO%"

echo [start] %DATE% %TIME% > "%LOG%"
echo === git version === >> "%LOG%"
"%GIT%" --version >> "%LOG%" 2>&1
echo === folder === >> "%LOG%"
cd >> "%LOG%"
echo === remote === >> "%LOG%"
"%GIT%" remote -v >> "%LOG%" 2>&1
echo === branch and commit === >> "%LOG%"
"%GIT%" rev-parse --abbrev-ref HEAD >> "%LOG%" 2>&1
"%GIT%" rev-parse --short HEAD >> "%LOG%" 2>&1
echo === working tree === >> "%LOG%"
"%GIT%" status --short >> "%LOG%" 2>&1
echo === commits not yet on GitHub === >> "%LOG%"
"%GIT%" log --oneline origin/main..HEAD >> "%LOG%" 2>&1

set "HEAD=?"
set "AHEAD=?"
for /f "delims=" %%h in ('"%GIT%" rev-parse --short HEAD 2^>nul') do set "HEAD=%%h"
for /f "delims=" %%n in ('"%GIT%" rev-list --count origin/main..HEAD 2^>nul') do set "AHEAD=%%n"

echo    Current commit    : %HEAD%
echo    Not yet on GitHub : %AHEAD%
echo.
echo    Pushing now. If a GitHub sign-in window opens, sign in there.
echo.

"%GIT%" config --local http.sslBackend openssl >nul 2>&1

set "RC=1"
for /L %%i in (1,1,5) do (
  if !RC! NEQ 0 (
    echo    attempt %%i of 5 ...
    echo === attempt %%i === >> "%LOG%"
    "%GIT%" push >> "%LOG%" 2>&1
    set "RC=!ERRORLEVEL!"
    if !RC! NEQ 0 ping -n 6 127.0.0.1 >nul
  )
)

if "%RC%"=="0" goto ok

echo.
echo    ============================================================
echo     PUSH FAILED   (exit code %RC%)
echo    ============================================================
echo.
echo     The exact reason was written to this file:
echo       %LOG%
echo     Open it with Notepad and read the LAST lines.
echo.
goto hold

:ok
echo.
echo    ============================================================
echo     PUSHED   --   commit %HEAD%
echo    ============================================================
echo.
echo     Vercel will redeploy in about a minute. Then open:
echo       https://worksheet-ai-l1td.vercel.app/api/health
echo.
echo PUSH OK %HEAD% >> "%LOG%"
goto hold

:hold
echo.
echo    This window stays open on purpose. Press any key to close it.
pause >nul
endlocal
