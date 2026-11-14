@echo off
setlocal
cd /d "%~dp0.."
call npm.cmd run data:cn-air
exit /b %ERRORLEVEL%