# Install the bridge watchdog for the current Windows user (no admin needed).
#
# Creates two Scheduled Tasks:
#   pi-browser-control-bridge-logon  -> run at logon
#   pi-browser-control-bridge-watch  -> run every 5 minutes
#
# Both call scripts/ensure-bridge.ps1, which starts the server only when down.
#
# Remove: schtasks /delete /tn "pi-browser-control-bridge-logon" /f
#         schtasks /delete /tn "pi-browser-control-bridge-watch" /f

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$ensure = Join-Path $PSScriptRoot "ensure-bridge.ps1"

if (-not (Test-Path $ensure)) {
  Write-Output "missing $ensure"
  exit 1
}

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensure`""

& schtasks /create /tn "pi-browser-control-bridge-logon" /tr $cmd /sc onlogon /rl LIMITED /f | Out-String | Write-Output
& schtasks /create /tn "pi-browser-control-bridge-watch" /tr $cmd /sc minute /mo 5 /rl LIMITED /f | Out-String | Write-Output

Write-Output ""
Write-Output "Installed. Verify with:"
Write-Output "  schtasks /query /tn pi-browser-control-bridge-watch"
Write-Output "  http://127.0.0.1:17832/health"
