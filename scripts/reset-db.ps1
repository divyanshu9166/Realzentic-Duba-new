# ──────────────────────────────────────────────────────────
#  Realzentic Dubai — Reset & Re-Seed Database (Windows)
#  Usage: powershell -ExecutionPolicy Bypass -File scripts\reset-db.ps1
# ──────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$nodePath = "C:\nodejs-new\node-v22.15.0-win-x64"
if (Test-Path -LiteralPath $nodePath) { $env:Path = "$nodePath;$env:Path" }
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
$sourceDatabaseUrl = ((Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($sourceDatabaseUrl)) { throw "DATABASE_URL is missing from .env" }
$sourceDatabaseUrl = $sourceDatabaseUrl.Trim().Trim('"').Trim("'")
$testDatabaseUri = [System.UriBuilder]::new([System.Uri]$sourceDatabaseUrl)
$testDatabaseUri.Path = "/realzentic_dubai_test"
$env:DATABASE_URL = $testDatabaseUri.Uri.AbsoluteUri
$env:SEED_ADMIN_PASSWORD = "TestOnly2026!"
$env:SEED_STAFF_PASSWORD = "StaffTest2026!"

Write-Host ""
Write-Host "Resetting isolated test database..." -ForegroundColor Yellow
npx prisma db push --force-reset

Write-Host "Seeding data..." -ForegroundColor Yellow
npx tsx prisma/seed.ts

Write-Host ""
Write-Host "Database reset complete!" -ForegroundColor Green
Write-Host "  Admin: admin@realzentic.com / TestOnly2026!" -ForegroundColor Magenta
Write-Host "  Staff: Omar Hassan / StaffTest2026!" -ForegroundColor Magenta
