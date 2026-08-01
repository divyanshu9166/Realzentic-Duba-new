#!/bin/bash
set -e

echo ""
echo "======================================"
echo "  Realzentic Dubai — UAE Setup"
echo "======================================"
echo ""

# ─── 1. Check prerequisites ──────────────────────────
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }

echo "[1/6] Prerequisites OK (Node $(node -v))"

# ─── 2. Create .env from template if missing ─────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[2/6] Created .env from .env.example"
  else
    touch .env
    echo "[2/6] Created empty .env file"
  fi
else
  echo "[2/6] .env already exists — skipping"
fi

# ─── 3. Generate Secrets if empty ─────────────────────
source .env 2>/dev/null || true

# NEXTAUTH_SECRET
if [ -z "$NEXTAUTH_SECRET" ]; then
  SECRET=$(openssl rand -base64 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env || echo "NEXTAUTH_SECRET=\"$SECRET\"" >> .env
  else
    sed -i "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"$SECRET\"|" .env || echo "NEXTAUTH_SECRET=\"$SECRET\"" >> .env
  fi
  echo "[3/6] Generated NEXTAUTH_SECRET"
fi

# CRM_API_SECRET
if [ -z "$CRM_API_SECRET" ]; then
  SECRET=$(openssl rand -base64 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('base64'))")
  echo "CRM_API_SECRET=\"$SECRET\"" >> .env
  echo "[4/6] Generated CRM_API_SECRET"
fi

# ─── 4. Install dependencies ─────────────────────────
echo "[5/6] Installing dependencies..."
npm install --silent

# ─── 5. Generate Prisma client ───────────────────────
echo "[6/6] Generating Prisma client..."
npx prisma generate

echo ""
echo "======================================"
echo "  Setup Complete!"
echo "======================================"
echo ""
echo "  Next steps:"
echo "  1. Update .env with your production credentials (DB, R2, etc.)"
echo "  2. Run 'docker compose up -d' to start the application"
echo "  3. Use 'npx prisma migrate deploy' to apply database schema"
echo ""
