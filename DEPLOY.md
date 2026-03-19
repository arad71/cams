# CAMS — Production Deployment Guide

## City of Kalamunda Crossover Approval Management System

**Version:** 3.1.0  
**Stack:** React + Vite | FastAPI + PostgreSQL | Docker Compose  
**Last Updated:** March 2026

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Docker Host                       │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐│
│  │ approval-   │  │ approval-    │  │ approval-   ││
│  │ frontend    │→ │ api          │→ │ db          ││
│  │ (nginx:3001)│  │ (gunicorn:   │  │ (postgres:  ││
│  │ React SPA   │  │  8000)       │  │  5432)      ││
│  │ + API proxy │  │ FastAPI      │  │ PostgreSQL  ││
│  └─────────────┘  └──────────────┘  └─────────────┘│
│        ↑                                             │
│   Port 3001 exposed                                  │
└─────────────────────────────────────────────────────┘
```

The frontend nginx serves the React SPA and proxies `/api/` and `/ai/` requests to the backend. The database is only accessible within the Docker network.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2
- 2+ GB RAM (4 GB recommended for AI document analysis)
- 10 GB disk for database + document uploads
- (Optional) Anthropic API key for AI site plan analysis

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/arad71/cams.git
cd cams
git checkout feature/db-rules-refactor
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# REQUIRED — change these
POSTGRES_PASSWORD=your_strong_db_password_here
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# OPTIONAL — AI document analysis
ANTHROPIC_API_KEY=sk-ant-...

# OPTIONAL — customize
CORS_ORIGINS=https://crossover.kalamunda.wa.gov.au
FRONTEND_PORT=3001
API_WORKERS=2
```

### 3. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 4. Verify

```bash
# Check all services are running
docker compose -f docker-compose.prod.yml ps

# Check API health
curl http://localhost:3001/api/health

# Check logs
docker compose -f docker-compose.prod.yml logs -f approval-api
```

### 5. Access the portal

Open `http://localhost:3001` in a browser.

**Default admin login:**
- Email: `m.thompson@kalamunda.wa.gov.au`
- Password: `admin123`

**Change this password immediately after first login.**

---

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `cams_approval` | Database name |
| `POSTGRES_USER` | `cams` | Database user |
| `POSTGRES_PASSWORD` | *(required)* | Database password |
| `SECRET_KEY` | *(required)* | JWT signing key (64+ hex chars) |
| `CORS_ORIGINS` | `http://localhost:3001` | Comma-separated allowed origins |
| `API_WORKERS` | `2` | Gunicorn worker processes |
| `FRONTEND_PORT` | `3001` | Port exposed on host |
| `ANTHROPIC_API_KEY` | *(empty)* | Anthropic API key for AI features |
| `AI_MODEL_DEFAULT` | `claude-sonnet-4-20250514` | Claude model for document analysis |
| `PDF_RENDER_DPI` | `200` | PDF rendering resolution |
| `MAX_IMAGE_DIM` | `2048` | Max image dimension for AI analysis |
| `AI_MAX_TOKENS` | `4096` | Max tokens in AI responses |

---

## What Gets Auto-Created on First Start

The backend automatically runs on startup:

1. **Database tables** — all tables created via SQLAlchemy `create_all()`
2. **Roles** — admin, manager, engineer, inspector, viewer
3. **Departments** — Asset Services, Engineering, Planning & Development, Parks & Environment, Compliance, Customer Service
4. **Seed data** (via `run_seed()`) — default users, assessment categories (11), assessment items (~60), assessment rules (~120), and sample applications

---

## Production Hardening

### Reverse Proxy (nginx on host)

For production with a domain name and SSL:

```nginx
# /etc/nginx/sites-available/cams
server {
    listen 80;
    server_name crossover.kalamunda.wa.gov.au;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name crossover.kalamunda.wa.gov.au;

    ssl_certificate     /etc/letsencrypt/live/crossover.kalamunda.wa.gov.au/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crossover.kalamunda.wa.gov.au/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

Then update `.env`:
```bash
CORS_ORIGINS=https://crossover.kalamunda.wa.gov.au
```

### SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d crossover.kalamunda.wa.gov.au
```

### Firewall

```bash
# Only allow HTTP/HTTPS and SSH
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Backup & Restore

### Database Backup

```bash
# Backup
docker compose -f docker-compose.prod.yml exec approval-db \
  pg_dump -U cams cams_approval | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Automated daily backup (add to crontab)
0 2 * * * cd /opt/cams && docker compose -f docker-compose.prod.yml exec -T approval-db pg_dump -U cams cams_approval | gzip > /opt/backups/cams_$(date +\%Y\%m\%d).sql.gz
```

### Database Restore

```bash
gunzip -c backup_20260319.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T approval-db psql -U cams cams_approval
```

### Document Uploads Backup

```bash
# The uploads volume contains all uploaded documents
docker compose -f docker-compose.prod.yml exec approval-api \
  tar czf /tmp/uploads.tar.gz /app/uploads
docker cp $(docker compose -f docker-compose.prod.yml ps -q approval-api):/tmp/uploads.tar.gz ./uploads_backup.tar.gz
```

---

## Updates & Redeployment

```bash
cd /opt/cams
git pull origin feature/db-rules-refactor

# Rebuild and restart (zero-downtime with --no-deps)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d --no-deps approval-api approval-frontend

# Check logs for startup errors
docker compose -f docker-compose.prod.yml logs -f --tail=50 approval-api
```

### Database Migrations

For schema changes (new columns, tables), the backend uses `create_all()` which adds missing tables/columns. For destructive changes, use Alembic:

```bash
docker compose -f docker-compose.prod.yml exec approval-api \
  alembic upgrade head
```

---

## Monitoring

### Health Check

```bash
curl -s http://localhost:3001/api/health | python3 -m json.tool
```

### Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f approval-api --tail=100

# Search for errors
docker compose -f docker-compose.prod.yml logs approval-api 2>&1 | grep -i error
```

### Resource Usage

```bash
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Frontend shows blank page | `docker logs` for frontend — check build errors |
| API returns 500 | `docker logs approval-api` — check traceback |
| Login fails | Check `SECRET_KEY` matches between restarts |
| AI analysis fails | Check `ANTHROPIC_API_KEY` in `.env` |
| Database connection refused | Check `approval-db` health: `docker compose ps` |
| Roles/departments empty | Restart API — auto-seeds on startup: `docker compose restart approval-api` |
| Slow performance | Increase `API_WORKERS` in `.env` |
| Upload fails | Check `client_max_body_size` in nginx, and volume mounts |

### Reset Everything

```bash
docker compose -f docker-compose.prod.yml down -v   # WARNING: deletes database!
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Security Checklist

- [ ] Changed default admin password on first login
- [ ] Set strong `POSTGRES_PASSWORD` in `.env`
- [ ] Generated random `SECRET_KEY` (64+ chars)
- [ ] SSL/TLS enabled via reverse proxy
- [ ] Firewall configured (ports 22, 80, 443 only)
- [ ] `.env` file permissions set to 600 (`chmod 600 .env`)
- [ ] Database not exposed to host (no ports mapping in prod compose)
- [ ] `DEBUG=false` in production
- [ ] Regular automated backups configured
- [ ] CORS_ORIGINS restricted to actual domain
