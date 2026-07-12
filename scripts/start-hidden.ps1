param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

function PortOpen([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (PortOpen 5173)) {
  $node = (Get-Command node.exe).Source
  $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
  Start-Process $node -WorkingDirectory $root -WindowStyle Hidden `
    -ArgumentList @($vite,'--host','127.0.0.1','--port','5173','--strictPort') `
    -RedirectStandardOutput (Join-Path $logs 'frontend.log') `
    -RedirectStandardError (Join-Path $logs 'frontend-error.log')
}

if (-not (PortOpen 8765)) {
  $python = (Get-Command python.exe).Source
  Start-Process $python -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden `
    -ArgumentList @('simulation_server.py') `
    -RedirectStandardOutput (Join-Path $logs 'backend.log') `
    -RedirectStandardError (Join-Path $logs 'backend-error.log')
}
Start-Sleep -Seconds 2
if (-not (PortOpen 8766)) {
  $electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
  Start-Process $electron -WorkingDirectory $root -WindowStyle Hidden `
    -ArgumentList @((Join-Path $root 'electron\main.cjs')) `
    -RedirectStandardOutput (Join-Path $logs 'agent.log') `
    -RedirectStandardError (Join-Path $logs 'agent-error.log')
}

if ($OpenBrowser) {
  Start-Sleep -Seconds 2
  Start-Process 'http://127.0.0.1:5173/index.html'
}