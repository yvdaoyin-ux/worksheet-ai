@echo off
setlocal
rem Push to GitHub -> Vercel auto-deploys in about a minute.
rem First run may open a browser window to sign in to GitHub.
cd /d "%~dp0"

echo ============================================================
echo  WorksheetAI - push to GitHub
echo  Folder: %CD%
echo ============================================================
echo.

rem --- SAFETY CHECK ---------------------------------------------------------
rem Never push from a BACKUP copy. The backups contain a full .git, so running
rem this file there pushes an OLD commit and silently rolls the live site back.
rem (This happened on 2026-10-05: GitHub was rolled back by 7 commits.)
echo %CD% | find /i "backup" >nul
if not errorlevel 1 (
  echo  *** WRONG FOLDER - STOPPING ***
  echo.
  echo  This is a BACKUP copy, not your working project.
  echo  Pushing from here would OVERWRITE the live site with an old version.
  echo.
  echo  Please run the copy of this file inside:
  echo     C:\Users\fa'r\Desktop\worksheet-ai\
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
for /f "delims=" %%h in ('git rev-parse --short HEAD') do set HEAD=%%h
echo  Branch: %BRANCH%
echo  Commit: %HEAD%
echo.
echo  Uncommitted changes (should be empty):
git status --short
echo.
echo Pushing... (a browser window may open once to sign in)
echo.

git config --local http.sslBackend openssl
for /L %%i in (1,1,5) do (
  git push
  if not errorlevel 1 goto done
  echo Push failed - retry %%i in 6 seconds...
  timeout /t 6 >nul
)
echo.
echo Push did NOT succeed. Please read the message above.
echo (Common causes: not signed in to GitHub, network/proxy, or nothing to push.)
pause
exit /b 1

:done
echo.
echo Pushed commit %HEAD% on branch %BRANCH%.
echo Vercel will deploy in about a minute.
echo Check: https://worksheet-ai-l1td.vercel.app/api/health
pause
