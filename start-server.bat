@echo off
title E-Commerce Analytics Server
cd /d "%~dp0"
echo ============================================================
echo   Starting E-Commerce Analytics Server...
echo   Opening http://localhost:3000 in your browser...
echo ============================================================
start "" "http://localhost:3000"
"C:\Program Files\nodejs\node.exe" server.js
pause
