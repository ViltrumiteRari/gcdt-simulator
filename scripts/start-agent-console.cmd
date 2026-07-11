@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

powershell -NoProfile -Command "if(-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)){Start-Process cmd -ArgumentList '/k','cd /d ""%ROOT%"" && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort' -WindowStyle Normal}"
powershell -NoProfile -Command "if(-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)){Start-Process cmd -ArgumentList '/k','cd /d ""%ROOT%\backend"" && python simulation_server.py' -WindowStyle Normal}"
timeout /t 3 /nobreak >nul
start "FirstSignal Agent Console" /min cmd /c "cd /d %ROOT% && npm run agent:desktop:dev"
endlocal
