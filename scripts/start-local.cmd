@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
start "GCDT Airgap API" cmd /k "cd /d %ROOT%\backend && python simulation_server.py"
start "GCDT Frontend" cmd /k "cd /d %ROOT% && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:5173/"
endlocal
