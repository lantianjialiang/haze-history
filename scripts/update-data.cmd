@echo off
setlocal
cd /d "%~dp0.."
if not exist data\update-logs mkdir data\update-logs
for /f %%i in ('node -p "new Date().toISOString().replace(/[:.]/g, '-')"') do set "UPDATE_LOG=data\update-logs\%%i.log"
if not defined UPDATE_LOG exit /b 1
call npm run data:update > "%UPDATE_LOG%" 2>&1
exit /b %errorlevel%
