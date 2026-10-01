@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run build
start "" http://localhost:4310
call npm start
