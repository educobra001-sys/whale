@echo off
rem Builds the EduCobra Android app and puts it where the server offers it for download (/get-app.html).
cd /d "%~dp0"
call flutter build apk --release
if errorlevel 1 exit /b 1
if not exist ..\downloads mkdir ..\downloads
copy /y build\app\outputs\flutter-apk\app-release.apk ..\downloads\educobra.apk
echo.
echo The app is ready: downloads\educobra.apk
echo Friends on your Wi-Fi can download it from http://YOUR-PC-ADDRESS:4000/get-app.html (start-lan.bat shows the address).
