@echo off
rem Starts EduCobra on this computer: database, cache and server.
cd /d "%~dp0"
call npm run db:start
if not exist dist\main.js call npm run build
echo.
echo EduCobra: http://127.0.0.1:4000
echo Owner sign-in: http://127.0.0.1:4000/login.html?role=owner
echo Close this window to stop the server. Run "npm run db:stop" to stop the database.
echo.
start "" "http://127.0.0.1:4000"
call npm start
