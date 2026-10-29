# Ensure the pi-browser-control bridge server is running.
# Idempotent: safe to run every few minutes from a Scheduled Task.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File ensure-bridge.ps1

$ErrorActionPreference = "SilentlyContinue"

$port = 17832
$repo = Split-Path -Parent $PSScriptRoot
$server = Join-Path $repo "native-host\bridge-server.mjs"

# Already up? Nothing to do.
$alive = $false
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 -UseBasicParsing
  if ($r.StatusCode -eq 200) { $alive = $true }
} catch { }

if ($alive) {
  Write-Output "bridge already running on port $port"
  exit 0
}

if (-not (Test-Path $server)) {
  Write-Output "server script missing: $server"
  exit 1
}

Start-Process -FilePath "node" -ArgumentList @($server, "--port", "$port") -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3 -UseBasicParsing
  Write-Output "bridge started on port $port"
  exit 0
} catch {
  Write-Output "bridge failed to start"
  exit 1
}
