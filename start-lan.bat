@echo off
rem Starts EduCobra for phones and friends on the same Wi-Fi: database, cache, server, and the address to connect.
cd /d "%~dp0"
call npm run db:start
if not exist dist\main.js call npm run build
node scripts\lan.js
call npm start
