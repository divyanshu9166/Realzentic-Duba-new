# RealZentic CRM — VPS Deployment Guide
**Domain:** `realzentic.autozentic.com`  
**Stack:** Next.js · PostgreSQL 16 (pgvector) · Redis 7 · Socket.io WS · Python AI Agent  
**Method:** Git → VPS · Docker Compose · Nginx · Let's Encrypt SSL  
**Storage:** 100% on VPS — no cloud storage

---

## Prerequisites checklist

Before starting, make sure:
- [ ] VPS is running Ubuntu 22.04 or 24.04
- [ ] DNS A record → `realzentic.autozentic.com` points to your VPS IP
- [ ] Port 22 (SSH), 80 (HTTP), 443 (HTTPS), 3001 (WS) are open
- [ ] You have your API keys ready (Gemini, Groq, Sarvam, Deepgram)

---

## Step 1 — VPS Initial Setup

SSH into your VPS:
```bash
ssh root@YOUR_VPS_IP
```

Update system and install essentials:
```bash
apt-get update && apt-get upgrade -y
apt-get install -y curl git wget gnupg ca-certificates lsb-release ufw fail2ban
```

Create a deploy user (recommended, skip if already done):
```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
su - deploy
```

---

## Step 2 — Install Docker & Docker Compose

```bash
# Add Docker's GPG key and repository
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow deploy user to run docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version && docker compose version
```

---

## Step 3 — Install Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx && sudo systemctl start nginx
```

---

## Step 4 — Push Code to GitHub (from your Windows PC)

Open PowerShell in `C:\Users\divya\Downloads\realzentic`:

```powershell
# Add binary files to gitignore first (optional but recommended)
Add-Content .gitignore "`nplink.exe`npscp.exe`n*.exe"

git add .
git commit -m "Production: realzentic.autozentic.com"
git remote add origin https://github.com/YOUR_USERNAME/realzentic.git
git branch -M main
git push -u origin main
```

---

## Step 5 — Clone on VPS

```bash
sudo mkdir -p /opt/realzentic
sudo chown deploy:deploy /opt/realzentic
git clone https://github.com/YOUR_USERNAME/realzentic.git /opt/realzentic
cd /opt/realzentic
```

---

## Step 6 — Create Production `.env`

```bash
cd /opt/realzentic
cp .env.production.example .env
nano .env
```

Generate secrets first:
```bash
# Run each separately, copy the output into .env
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -base64 32   # → SESSION_SECRET
openssl rand -base64 32   # → CRM_API_SECRET
openssl rand -hex 32      # → ENCRYPTION_KEY
openssl rand -base64 24   # → POSTGRES_PASSWORD
```

Fill in your `.env`:
```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<generated above>
POSTGRES_DB=realestatecrm

DOMAIN=realzentic.autozentic.com
NEXTAUTH_URL=https://realzentic.autozentic.com
NEXT_PUBLIC_APP_URL=https://realzentic.autozentic.com
NEXT_PUBLIC_WS_URL=https://realzentic.autozentic.com:3001

NEXTAUTH_SECRET=<generated above>
SESSION_SECRET=<generated above>
CRM_API_SECRET=<generated above>
ENCRYPTION_KEY=<generated above>

REDIS_URL=redis://redis:6379
UPLOAD_DIR=/app/uploads

GEMINI_API_KEY=your_key_here
GROQ_API_KEY=your_key_here
SARVAM_API_KEY=your_key_here
DEEPGRAM_API_KEY=your_key_here
# ... rest of API keys
```

---

## Step 7 — SSL Certificate

> ⚠️ DNS must be propagated (A record pointing to VPS IP) before this step.

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo systemctl stop nginx

sudo certbot certonly --standalone -d realzentic.autozentic.com

sudo systemctl start nginx
```

---

## Step 8 — Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/realzentic
```

Paste exactly:
```nginx
server {
    listen 80;
    server_name realzentic.autozentic.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name realzentic.autozentic.com;

    ssl_certificate /etc/letsencrypt/live/realzentic.autozentic.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/realzentic.autozentic.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Allow large file uploads (property photos, documents)
    client_max_body_size 50M;

    # Extended timeouts for AI API calls
    proxy_connect_timeout 90s;
    proxy_send_timeout 90s;
    proxy_read_timeout 90s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and test:
```bash
sudo ln -s /etc/nginx/sites-available/realzentic /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default  # Remove default site
sudo nginx -t                                 # Must say "test is successful"
sudo systemctl reload nginx
```

---

## Step 9 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp      # WebSocket server (socket.io)
sudo ufw enable
sudo ufw status verbose
```

> **Do NOT expose 3000 (Next.js), 5432 (Postgres), or 6379 (Redis) publicly.**  
> They are internal Docker network only.

---

## Step 10 — Build & Deploy

```bash
cd /opt/realzentic

# First deploy — builds all Docker images (~5-10 min)
docker compose up -d --build

# Watch logs
docker compose logs -f
```

Watch for all services to become healthy:
```bash
docker compose ps
```

Expected output:
```
NAME                    STATUS          PORTS
realzentic-db-1         healthy
realzentic-redis-1      healthy
realzentic-migrate-1    exited (0)      ← migrations ran successfully
realzentic-app-1        healthy         127.0.0.1:3000->3000/tcp
realzentic-ws-server-1  healthy         0.0.0.0:3001->3001/tcp
realzentic-ai-agent-1   running
```

---

## Step 11 — Seed Admin User

```bash
cd /opt/realzentic

docker compose exec app node -e "
const { PrismaClient } = require('.prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
async function main() {
  const hash = await bcrypt.hash('Admin@123', 12);
  const user = await prisma.user.upsert({
    where: { email: 'admin@autozentic.com' },
    update: {},
    create: {
      email: 'admin@autozentic.com',
      name: 'Admin',
      hashedPassword: hash,
      role: 'ADMIN'
    }
  });
  console.log('✅ Admin created:', user.email);
  await prisma.\$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

> Change `admin@autozentic.com` and `Admin@123` to your own credentials.

---

## Step 12 — Cron Jobs

```bash
crontab -e
```

Add (replace `YOUR_CRM_API_SECRET` from your `.env`):
```cron
# Realzentic Dubai — Scheduled Tasks

# Follow-up reminders — 9 AM daily
0 9 * * * curl -sf -H "x-api-secret: YOUR_CRM_API_SECRET" https://realzentic.autozentic.com/api/cron/follow-up-reminders >> /var/log/crm-cron.log 2>&1

# WhatsApp reminders — 10 AM daily (enable only after template approval)
0 10 * * * curl -sf -H "x-api-secret: YOUR_CRM_API_SECRET" https://realzentic.autozentic.com/api/cron/whatsapp-reminders >> /var/log/crm-cron.log 2>&1

# Database backup — 2 AM daily (keeps last 30 days)
0 2 * * * docker compose -f /opt/realzentic/docker-compose.yml exec -T db pg_dump -U postgres realzentic_dubai | gzip > /opt/backups/realzentic_dubai_$(date +\%Y\%m\%d).sql.gz
0 3 * * * find /opt/backups -name "*.sql.gz" -mtime +30 -delete
```

Create backup directory:
```bash
sudo mkdir -p /opt/backups
sudo chown deploy:deploy /opt/backups
```

---

## Step 13 — Verify

```bash
# All containers healthy?
docker compose ps

# App responding?
curl -I https://realzentic.autozentic.com

# WebSocket server?
curl http://localhost:3001/health

# Database has tables?
docker compose exec db psql -U postgres -d realestatecrm -c "\dt" | head -20
```

Visit **https://realzentic.autozentic.com** → login with your admin credentials.

---

## Updating the App (Future Deploys)

On your Windows PC — push changes:
```powershell
git add .
git commit -m "your changes"
git push
```

On VPS — pull and redeploy:
```bash
cd /opt/realzentic
git pull origin main
docker compose up -d --build
```

Prisma migrations run automatically via the `migrate` service on every deploy.

---

## Database Backup & Restore

### Manual Backup
```bash
docker compose exec -T db pg_dump -U postgres realestatecrm | gzip > /opt/backups/manual_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restore
```bash
# Stop app during restore
docker compose stop app ws-server ai-agent

gunzip -c /opt/backups/realestatecrm_20260629.sql.gz | \
  docker compose exec -T db psql -U postgres realestatecrm

docker compose start app ws-server ai-agent
```

---

## Troubleshooting

| Problem | Command |
|---|---|
| App not starting | `docker compose logs app --tail=50` |
| DB not healthy | `docker compose logs db --tail=30` |
| Migrations failed | `docker compose logs migrate` |
| Nginx 502 | `curl http://127.0.0.1:3000/api/auth/me` |
| WS not connecting | `curl http://localhost:3001/health` |
| Disk full | `docker system prune -a` |

### SSL renewal (auto, but test it)
```bash
sudo certbot renew --dry-run
```

---

## Architecture

```
Browser
  │
  ▼
[Nginx :443 HTTPS]  realzentic.autozentic.com
  │
  ├──► [Next.js app  :3000]  ──► [PostgreSQL :5432]  (pgvector, VPS volume)
  │           │               ──► [Redis      :6379]  (BullMQ, VPS volume)
  │           │               ──► [AI Agent   Python] (Sarvam TTS / Deepgram)
  │
[UFW :3001] ──► [WS Server :3001]  (socket.io, Redis pub/sub)

All uploads → Docker volume (realzentic_uploads) on VPS
All DB data → Docker volume (realzentic_pgdata)  on VPS
```
