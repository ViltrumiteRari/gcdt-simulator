@echo off
setlocal
set "ROOT=%~dp0.."
set "FIRSTSIGNAL_AGENT_PORT=%~1"
set "FIRSTSIGNAL_USER_DATA=%~2"
set "FIRSTSIGNAL_REPORT_FOLDER=%~3"
set "FIRSTSIGNAL_CAMPAIGN_ID=%~4"
set "FIRSTSIGNAL_WORKER_ID=%~5"
set "FIRSTSIGNAL_WORKER_MODE=1"
set "FIRSTSIGNAL_OBSERVER_MODE=posthoc"
set "FIRSTSIGNAL_URL=http://127.0.0.1:5173/index.html?agentPort=%~1&worker=%~5"
"%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%\electron\main.cjs"
endlocal