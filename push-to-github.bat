@echo off
rem Push to GitHub -> Vercel auto-deploys in about a minute.
rem First run may open a browser window to sign in to GitHub.
cd /d "%~dp0"
git config --local http.sslBackend openssl
echo.
echo Pushing worksheet-ai to GitHub...
echo (a browser window may open once to sign in)
echo.
for /L %%i in (1,1,5) do (
  git push
  if not errorlevel 1 goto done
  echo Push failed - retry %%i in 6 seconds...
  timeout /t 6 >nul
)
echo.
echo Push did not succeed. Please read the message above.
pause
exit /b 1

:done
echo.
echo Pushed. Vercel will deploy in about a minute.
echo Then check: https://worksheet-ai-l1td.vercel.app/api/health
pause
