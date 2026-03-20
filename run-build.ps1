$ErrorActionPreference = 'Stop'

$nodeDir = 'C:\Program Files\nodejs'
if (Test-Path "$nodeDir\node.exe") {
  $env:Path = "$nodeDir;" + $env:Path
}

Write-Host 'Building Vertebrae...'
npm run build
Write-Host 'Build complete.'
