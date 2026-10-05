@echo off
rem Prende la versión de PRUEBA de MAJA (datos inventados) y la abre en el navegador.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist dist\index.html call npx vite build
set PORT=4399
set DATA_DIR=%~dp0datos-prueba
start "" http://localhost:4399
node --disable-warning=ExperimentalWarning server/index.js
