# ----------------------------------------------------------
#  Realzentic Dubai - Local Development Startup Script (Windows)
#  Run this once instead of remembering all the steps.
#  Usage: powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
# ----------------------------------------------------------

$ErrorActionPreference = "Stop"

# --- 1. Prefer the bundled Node.js path when it exists ---
$nodePath = "C:\nodejs-new\node-v22.15.0-win-x64"
if (Test-Path -LiteralPath $nodePath) { $env:Path = "$nodePath;$env:Path" }

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Realzentic Dubai - Starting Dev Env" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# --- 2. Check Node.js version -----------------------------
$nodeVersion = node --version
Write-Host "[1/6] Node.js $nodeVersion" -ForegroundColor Green

# --- 3. Start PostgreSQL (if not already running) ---------
$pgRunning = $false
$pgReadyCommand = Get-Command pg_isready.exe -ErrorAction SilentlyContinue
if ($pgReadyCommand) {
    & $pgReadyCommand.Source -h localhost -p 5432 2>&1 | Out-Null
    $pgRunning = ($LASTEXITCODE -eq 0)
} else {
    $pgRunning = [bool](Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)
}

if (-not $pgRunning) {
    $pgCtlCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if (-not $pgCtlCommand) {
        throw "PostgreSQL is not listening on port 5432 and pg_ctl.exe was not found. Start PostgreSQL first, then rerun this script."
    }
    Write-Host "[2/6] Starting PostgreSQL..." -ForegroundColor Yellow
    & $pgCtlCommand.Source -D "C:\pgsql-local\data" -l "C:\pgsql-local\pg.log" start
    Start-Sleep -Seconds 2
} else {
    Write-Host "[2/6] PostgreSQL already running" -ForegroundColor Green
}

# --- 4. Set the isolated testing DATABASE_URL -------------
# Preserve the local credentials from .env, but never reuse its database name.
$envFile = Join-Path (Get-Location) ".env"
$sourceDatabaseUrl = ((Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($sourceDatabaseUrl)) { throw "DATABASE_URL is missing from .env" }
$sourceDatabaseUrl = $sourceDatabaseUrl.Trim().Trim('"').Trim("'")
$testDatabaseUri = [System.UriBuilder]::new([System.Uri]$sourceDatabaseUrl)
$testDatabaseUri.Path = "/realzentic_dubai_test"
$env:DATABASE_URL = $testDatabaseUri.Uri.AbsoluteUri
Write-Host "[3/6] Testing DATABASE_URL set" -ForegroundColor Green

# BullMQ requires Redis 5+. The legacy Redis bundled on some Windows setups is
# older, so keep optional WhatsApp/automation workers off during local CRM UI
# testing. Production and Docker continue to start them normally.
$env:DISABLE_BACKGROUND_WORKERS = "1"

# --- 5. Check if node_modules exists, install if not ------
if (-not (Test-Path "node_modules")) {
    Write-Host "[4/6] Installing dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "[4/6] Dependencies already installed" -ForegroundColor Green
}

# --- 6. Keep the isolated test database schema current ----
Write-Host "[5/6] Applying schema to test database..." -ForegroundColor Green
npx prisma db push --skip-generate

# --- 7. Start Next.js dev server ---------------------------
Write-Host "[6/6] Starting Next.js..." -ForegroundColor Green
Write-Host ""
Write-Host "  Admin Login:  admin@realzentic.com / TestOnly2026!" -ForegroundColor Magenta
Write-Host "  Staff Login:  Omar Hassan / StaffTest2026! (after reset-db.ps1)" -ForegroundColor Magenta
Write-Host "  URL:          http://localhost:3001" -ForegroundColor Magenta
Write-Host ""

# This CRM is large enough for the default Node.js heap to OOM during the
# first development compile. Keep any caller-provided options and add a safe
# heap limit only when one was not already supplied.
if ($env:NODE_OPTIONS -notmatch "--max-old-space-size") {
    $existingNodeOptions = if ($env:NODE_OPTIONS) { $env:NODE_OPTIONS.Trim() } else { "" }
    $env:NODE_OPTIONS = "$existingNodeOptions --max-old-space-size=2048".Trim()
}

# A stale development bundle can render new server HTML with old client code,
# causing hydration errors and dead buttons. A local dev cache is disposable,
# so start every scripted session from a clean bundle.
$projectRoot = (Resolve-Path (Get-Location)).Path

# If this project is already running on the development port, stop only that
# project's Next process before cleaning its cache. This makes `npm run dev`
# safe to use as a restart command and avoids deleting `.next` while a watcher
# is still recreating files.
$existingListeners = @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $existingListeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerCommandLine = if ($owner) { [string]$owner.CommandLine } else { "" }
    if ($ownerCommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $pidsToStop = @([int]$listener.OwningProcess)
        if ($owner.ParentProcessId) {
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ParentProcessId)" -ErrorAction SilentlyContinue
            if ($parent -and ([string]$parent.CommandLine).IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $pidsToStop += [int]$parent.ProcessId
            }
        }
        Write-Host "[6/6] Existing Realzentic dev server detected; restarting it..." -ForegroundColor Yellow
        $pidsToStop | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 800
    } else {
        throw "Port 3001 is already in use by another application. Stop that application or change the local port before starting Realzentic."
    }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path -LiteralPath $nextCache) {
    $resolvedCache = (Resolve-Path -LiteralPath $nextCache).Path
    if (-not $resolvedCache.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar)) {
        throw "Refusing to clean Next.js cache outside the project: $resolvedCache"
    }
    $cacheRemoved = $false
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolvedCache -Recurse -Force -ErrorAction Stop
            $cacheRemoved = -not (Test-Path -LiteralPath $resolvedCache)
            if ($cacheRemoved) { break }
        } catch {
            if ($attempt -eq 5) {
                throw "Could not clear the Next.js cache at $resolvedCache. Close any other Realzentic terminal/server windows and try again."
            }
            Start-Sleep -Milliseconds 500
        }
    }
}

# Webpack dev mode is more stable on this Windows workstation for the first
# compile; production builds continue to use the normal Next.js build command.
npx next dev --webpack --port 3001
