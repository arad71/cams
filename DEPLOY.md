# CAMS — Production Deployment Guide

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Azure VM (B2s — 2 vCPU, 4GB RAM)                   │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────┐           │
│  │ approval-frontend│  │   cams-cron      │           │
│  │ (nginx + react) │  │ (lot.geojson)    │           │
│  │ port 3001       │  └──────────────────┘           │
│  └────────┬────────┘                                 │
│           │ /api proxy                               │
│  ┌────────┴────────┐                                 │
│  │  approval-api   │                                 │
│  │  (FastAPI)      │──── DATABASE_URL ────┐          │
│  └─────────────────┘                      │          │
└───────────────────────────────────────────┼──────────┘
                                            │
                              ┌─────────────┴──────────┐
                              │ Azure PostgreSQL        │
                              │ Flexible Server         │
                              │                         │
                              │ ✓ Auto backups (7 days) │
                              │ ✓ Point-in-time restore │
                              │ ✓ SSL encrypted         │
                              └─────────────────────────┘
```

---

## Part 1 — Azure VM Setup

### 1.1 Create Resource Group

**Portal**: Search "Resource groups" → Create
- Name: `cams-rg`
- Region: `Australia Southeast`

**CLI**:
```bash
az group create --name cams-rg --location australiasoutheast
```

### 1.2 Create Virtual Machine

| Setting | Value |
|---------|-------|
| Resource group | `cams-rg` |
| VM name | `cams-vm` |
| Region | `Australia Southeast` |
| Image | `Ubuntu Server 24.04 LTS - x64 Gen2` |
| Size | `Standard_B2s` (2 vCPU, 4 GB RAM) |
| Authentication | SSH public key (recommended) |
| Username | `azureuser` |

**CLI**:
```bash
az vm create \
  --resource-group cams-rg \
  --name cams-vm \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard
```

### 1.3 Open Firewall Ports

| Port | Service |
|------|---------|
| 3001 | Approval Portal |
| 8000 | API docs (optional) |

```bash
az vm open-port --resource-group cams-rg --name cams-vm --port 3001 --priority 1001
```

### 1.4 Get Public IP

```bash
az vm show -d --resource-group cams-rg --name cams-vm --query publicIps -o tsv
```

---

## Part 2 — Database Setup

### 2.1 Create Azure PostgreSQL Flexible Server

| Setting | Value |
|---------|-------|
| Resource group | `cams-rg` |
| Server name | `cams-db` |
| Region | `Australia Southeast` |
| PostgreSQL version | `16` |
| Workload type | `Development` |
| Compute | `Burstable B1ms` (1 vCPU, 2GB) |
| Storage | `32 GB` |
| Admin username | `camsadmin` |
| Admin password | (save this!) |

**CLI**:
```bash
az postgres flexible-server create \
  --resource-group cams-rg \
  --name cams-db \
  --location australiasoutheast \
  --admin-user camsadmin \
  --admin-password 'YourStrongPassword123!' \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0

az postgres flexible-server db create \
  --resource-group cams-rg \
  --server-name cams-db \
  --database-name cams_approval

# Allow Azure services
az postgres flexible-server firewall-rule create \
  --resource-group cams-rg --name cams-db \
  --rule-name AllowAzure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# Allow your VM's IP
az postgres flexible-server firewall-rule create \
  --resource-group cams-rg --name cams-db \
  --rule-name AllowVM \
  --start-ip-address <VM-PUBLIC-IP> --end-ip-address <VM-PUBLIC-IP>
```

### 2.2 Test Connection

```bash
ssh azureuser@<VM-IP>
sudo apt-get install -y postgresql-client
psql "postgresql://camsadmin:YourStrongPassword123!@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require"
# Should see: cams_approval=>   Type \q to quit
```

---

## Part 3 — Deploy CAMS

### 3.1 SSH and Run Setup Script

```bash
ssh azureuser@<VM-IP>
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/arad71/cams/master/setup-azure.sh)"
```

This installs Docker, clones the repo, and deploys the test environment.

### 3.2 Switch to Production (External DB)

```bash
cd /opt/cams
sudo ./deploy.sh prod
```

This copies `.env.production` → `.env` and prompts you to edit it. Set these values:

```bash
sudo nano .env
```

```
DATABASE_URL=postgresql://camsadmin:YourStrongPassword123!@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require
ANTHROPIC_API_KEY=sk-ant-your-key-here
CORS_ORIGINS=https://crossover.council.wa.gov.au
```

Then run again:

```bash
sudo ./deploy.sh prod
```

### 3.3 Verify

```bash
sudo ./deploy.sh status
sudo ./deploy.sh logs
```

Open `http://<VM-IP>:3001` and login.

---

## Part 4 — Management

### Daily Commands

```bash
cd /opt/cams
./deploy.sh status     # What's running
./deploy.sh logs       # View logs
./deploy.sh update     # Pull latest code + rebuild
./deploy.sh backup     # Dump database to SQL file
./deploy.sh reseed     # Clear all data + reseed rules
./deploy.sh stop       # Stop services
./deploy.sh prod       # Start production
```

### Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@council.wa.gov.au | admin123 |
| Manager | manager@council.wa.gov.au | manager123 |
| Engineer | engineer@council.wa.gov.au | engineer123 |
| Viewer | viewer@council.wa.gov.au | viewer123 |

---

## Part 5 — Backup & Restore

### Automatic (Azure handles this)

Azure Flexible Server: daily backups, 7-day retention, point-in-time restore.

### Manual Backup

```bash
./deploy.sh backup
# Creates: cams_backup_YYYYMMDD_HHMMSS.sql
```

### Point-in-Time Restore

Azure Portal → Flexible Server → Backup + restore → Restore → Pick date/time.

### Migrate from Docker DB to External DB

```bash
# Dump from Docker
sudo docker compose -f docker-compose.prod.yml exec approval-db \
  pg_dump -U cams cams_approval > ~/cams_migrate.sql

# Load into Azure
psql "postgresql://camsadmin:pass@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require" \
  < ~/cams_migrate.sql

# Switch to external DB
sudo ./deploy.sh prod
```

---

## Part 6 — Entra ID SSO (Optional)

1. Azure Portal → App registrations → New registration
   - Redirect URI: `http://<VM-IP>:3001/`
   - Account types: Single tenant
   - Permissions: openid, profile, email

2. Create client secret

3. Edit `.env`:
```
ENTRA_ENABLED=true
ENTRA_TENANT_ID=your-tenant-id
ENTRA_CLIENT_ID=your-client-id
ENTRA_CLIENT_SECRET=your-secret
ENTRA_REDIRECT_URI=http://<VM-IP>:3001/
```

4. Restart: `./deploy.sh prod`

---

## Cost Summary

| Component | Monthly (AUD) |
|-----------|--------------|
| VM B2s (2 vCPU, 4GB) | ~$50 |
| PostgreSQL Flexible B1ms | ~$25 |
| Public IP | ~$5 |
| **Total** | **~$80/mo** |

### Pause when not in use (~$10/mo)

```bash
az vm deallocate --resource-group cams-rg --name cams-vm
az postgres flexible-server stop --resource-group cams-rg --name cams-db

# Resume
az vm start --resource-group cams-rg --name cams-vm
az postgres flexible-server start --resource-group cams-rg --name cams-db
```

### Destroy everything

```bash
az group delete --name cams-rg --yes --no-wait
```
