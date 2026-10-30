@echo off
rem Closes the public link and stops the server. The data stays.
cd /d "%~dp0"
call npm run public:stop
pause
