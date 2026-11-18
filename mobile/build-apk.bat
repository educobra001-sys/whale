@echo off
rem Builds the EduCobra Android app and puts it where the server offers it for download (/get-app.html).
rem
rem   build-apk.bat https://your-app.vercel.app   the app opens straight on that online server
rem   build-apk.bat                               uses the address from last time (server-url.txt), or asks in the app
rem
cd /d "%~dp0"
set "SERVER=%~1"
if not "%SERVER%"=="" (echo %SERVER%> server-url.txt)
if "%SERVER%"=="" if exist server-url.txt set /p SERVER=<server-url.txt
if "%SERVER%"=="" (
  echo No online server given: the app will ask for the address when it first opens.
  call flutter build apk --release
) else (
  echo Online server: %SERVER%
  call flutter build apk --release --dart-define=SERVER_URL=%SERVER%
)
if errorlevel 1 exit /b 1
if not exist ..\downloads mkdir ..\downloads
copy /y build\app\outputs\flutter-apk\app-release.apk ..\downloads\educobra.apk
echo.
echo The app is ready: downloads\educobra.apk
echo Send this file to your users (WhatsApp, Drive...), or run start-lan.bat to offer it on your Wi-Fi
echo at http://YOUR-PC-ADDRESS:4000/get-app.html.
