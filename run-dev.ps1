$ErrorActionPreference = 'Stop'

$nodeDir = 'C:\Program Files\nodejs'
if (Test-Path "$nodeDir\node.exe") {
  $env:Path = "$nodeDir;" + $env:Path
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js not found. Install Node.js LTS first: winget install --id OpenJS.NodeJS.LTS -e"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm not found. Reopen terminal after installing Node.js, then try again."
}

if (-not (Test-Path '.\node_modules')) {
  Write-Host 'Installing dependencies...'
  npm install
}

$devPort = 5173
$listener = Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Host "Port $devPort is in use by PID $($listener.OwningProcess). Stopping stale process..."
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
}

Write-Host 'Starting dev app (Vite + Electron)...'
npm run dev
