@echo off
rem Starts EduCobra and opens a temporary public link for friends. Run stop-public.bat to close it.
cd /d "%~dp0"
call npm run db:start
call npm run build
call npm run public
pause
