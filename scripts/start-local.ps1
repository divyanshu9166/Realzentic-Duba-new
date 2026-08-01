# ──────────────────────────────────────────────────────────
#  Realzentic Dubai — Local Development Startup Script (Windows)
#  Run this once instead of remembering all the steps.
#  Usage: powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
# ──────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# ─── 1. Set PATH to use correct Node.js & PostgreSQL ────
$env:Path = "C:\pgsql-local\pgsql\bin;C:\nodejs-new\node-v22.15.0-win-x64;" + $env:Path

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Realzentic Dubai — Starting Dev Env" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# ─── 2. Check Node.js version ────────────────────────────
$nodeVersion = node --version
Write-Host "[1/5] Node.js $nodeVersion" -ForegroundColor Green

# ─── 3. Start PostgreSQL (if not already running) ────────
$pgRunning = $false
try {
    $result = & "C:\pgsql-local\pgsql\bin\pg_isready.exe" -h localhost -p 5432 2>&1
    if ($LASTEXITCODE -eq 0) { $pgRunning = $true }
} catch {}

if (-not $pgRunning) {
    Write-Host "[2/5] Starting PostgreSQL..." -ForegroundColor Yellow
    & "C:\pgsql-local\pgsql\bin\pg_ctl.exe" -D "C:\pgsql-local\data" -l "C:\pgsql-local\pg.log" start
    Start-Sleep -Seconds 2
} else {
    Write-Host "[2/5] PostgreSQL already running" -ForegroundColor Green
}

# ─── 4. Set the isolated testing DATABASE_URL ─────────────
# Preserve the local credentials from .env, but never reuse its database name.
$envFile = Join-Path (Get-Location) ".env"
$sourceDatabaseUrl = (Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', ''
if ([string]::IsNullOrWhiteSpace($sourceDatabaseUrl)) { throw "DATABASE_URL is missing from .env" }
$sourceDatabaseUrl = $sourceDatabaseUrl.Trim().Trim('"').Trim("'")
$testDatabaseUri = [System.UriBuilder]::new([System.Uri]$sourceDatabaseUrl)
$testDatabaseUri.Path = "/realzentic_dubai_test"
$env:DATABASE_URL = $testDatabaseUri.Uri.AbsoluteUri
Write-Host "[3/5] Testing DATABASE_URL set" -ForegroundColor Green

# ─── 5. Check if node_modules exists, install if not ─────
if (-not (Test-Path "node_modules")) {
    Write-Host "[4/5] Installing dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "[4/5] Dependencies already installed" -ForegroundColor Green
}

# ─── 6. Start Next.js dev server ─────────────────────────
Write-Host "[5/5] Starting Next.js..." -ForegroundColor Green
Write-Host ""
Write-Host "  Admin Login:  admin@realzentic.ae / set SEED_ADMIN_PASSWORD" -ForegroundColor Magenta
Write-Host "  Staff Login:  [staff email] / staff123" -ForegroundColor Magenta
Write-Host "  URL:          http://localhost:3000" -ForegroundColor Magenta
Write-Host ""

npm run dev
