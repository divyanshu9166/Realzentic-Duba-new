# ──────────────────────────────────────────────────────────
#  Realzentic Dubai — Stop Local Dev Environment (Windows)
#  Usage: powershell -ExecutionPolicy Bypass -File scripts\stop-local.ps1
# ──────────────────────────────────────────────────────────

$env:Path = "C:\pgsql-local\pgsql\bin;C:\nodejs-new\node-v22.15.0-win-x64;" + $env:Path

Write-Host ""
Write-Host "Stopping PostgreSQL..." -ForegroundColor Yellow
& "C:\pgsql-local\pgsql\bin\pg_ctl.exe" -D "C:\pgsql-local\data" stop

Write-Host "Done. All services stopped." -ForegroundColor Green
