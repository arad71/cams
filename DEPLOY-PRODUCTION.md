# CAMS — Production Deployment (External Database)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Azure VM (B2s — $50/mo)                             │
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
                              │ ($25/mo)                │
                              │                         │
                              │ ✓ Auto backups (7 days) │
                              │ ✓ Point-in-time restore │
                              │ ✓ SSL encrypted         │
                              │ ✓ Auto patching         │
                              └─────────────────────────┘
```

---

## Step 1 — Create Azure PostgreSQL Flexible Server

### Azure Portal

1. Search **"Azure Database for PostgreSQL Flexible Server"** → Create
2. Fill in:

| Setting | Value |
|---------|-------|
| Resource group | `cams-test-rg` (same as VM) |
| Server name | `cams-db` (becomes cams-db.postgres.database.azure.com) |
| Region | `Australia Southeast` |
| PostgreSQL version | `16` |
| Workload type | `Development` (cheapest) |
| Compute + storage | `Burstable B1ms` (1 vCPU, 2GB — ~$25 AUD/mo) |
| Storage | `32 GB` |
| Admin username | `camsadmin` |
| Admin password | (strong password — save this!) |

3. **Networking** tab:
   - Connectivity: `Public access`
   - Firewall: Add your VM's IP address
   - Check **"Allow public access from any Azure service"**

4. Click **Review + create** → **Create** (takes 5-10 minutes)

### Or Azure CLI

```bash
# Create the server
az postgres flexible-server create \
  --resource-group cams-test-rg \
  --name cams-db \
  --location australiasoutheast \
  --admin-user camsadmin \
  --admin-password 'YourStrongPassword123!' \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --public-access 0.0.0.0

# Create the database
az postgres flexible-server db create \
  --resource-group cams-test-rg \
  --server-name cams-db \
  --database-name cams_approval

# Allow Azure services
az postgres flexible-server firewall-rule create \
  --resource-group cams-test-rg \
  --name cams-db \
  --rule-name AllowAzure \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Allow your VM's IP (get it from VM overview)
az postgres flexible-server firewall-rule create \
  --resource-group cams-test-rg \
  --name cams-db \
  --rule-name AllowVM \
  --start-ip-address <VM-PUBLIC-IP> \
  --end-ip-address <VM-PUBLIC-IP>
```

---

## Step 2 — Test Database Connection

SSH into your VM and test:

```bash
# Install psql client
sudo apt-get install -y postgresql-client

# Test connection
psql "postgresql://camsadmin:YourStrongPassword123!@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require"

# Should see: cams_approval=>
# Type \q to quit
```

---

## Step 3 — Deploy CAMS with External DB

```bash
cd /opt/cams

# Create production .env
sudo cp .env.production.example .env
sudo nano .env
```

Set these values in `.env`:

```
DATABASE_URL=postgresql://camsadmin:YourStrongPassword123!@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require
SECRET_KEY=<generate with: python3 -c "import secrets; print(secrets.token_hex(32))">
ANTHROPIC_API_KEY=sk-ant-your-key-here
CORS_ORIGINS=*
```

Then start with the external-db compose file:

```bash
sudo docker compose -f docker-compose.external-db.yml up -d --build
```

---

## Step 4 — Verify

```bash
# Check containers
sudo docker compose -f docker-compose.external-db.yml ps

# Check logs — should see "Created 206 assessment rules"
sudo docker compose -f docker-compose.external-db.yml logs -f approval-api

# Check database has tables
psql "postgresql://camsadmin:YourStrongPassword123!@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require" \
  -c "\dt"
```

Open `http://<VM-IP>:3001` and login.

---

## Backup & Restore

### Automatic Backups (Azure handles this)

Azure Flexible Server creates daily backups automatically:
- **Retention**: 7 days (default, can extend to 35)
- **Type**: Full daily + continuous WAL archiving
- **Restore**: Point-in-time to any second within retention

### Manual Backup

```bash
# From the VM
pg_dump "postgresql://camsadmin:password@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require" \
  > ~/cams_backup_$(date +%Y%m%d_%H%M).sql

# Restore
psql "postgresql://camsadmin:password@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require" \
  < ~/cams_backup_20260329_1430.sql
```

### Point-in-Time Restore (Azure Portal)

1. Go to your Flexible Server → **Backup + restore**
2. Click **Restore**
3. Pick date/time → Creates a new server with data as of that moment

---

## Switching from Docker DB to External DB

If you already have data in the Docker database and want to migrate:

```bash
cd /opt/cams

# 1. Dump from Docker database
sudo docker compose -f docker-compose.prod.yml exec approval-db \
  pg_dump -U cams cams_approval > ~/cams_migrate.sql

# 2. Stop old stack
sudo docker compose -f docker-compose.prod.yml down

# 3. Load into Azure database
psql "postgresql://camsadmin:password@cams-db.postgres.database.azure.com:5432/cams_approval?sslmode=require" \
  < ~/cams_migrate.sql

# 4. Start new stack with external DB
sudo cp .env.production.example .env
sudo nano .env  # set DATABASE_URL
sudo docker compose -f docker-compose.external-db.yml up -d --build
```

---

## Cost Summary

| Component | Monthly (AUD) |
|-----------|--------------|
| VM B2s (2 vCPU, 4GB) | ~$50 |
| PostgreSQL Flexible B1ms | ~$25 |
| Storage 32GB | included |
| Backups 7-day | included |
| Public IP | ~$5 |
| **Total** | **~$80/mo** |

### To reduce cost when not in use:

```bash
# Stop VM (keeps disk, stops compute billing)
az vm deallocate --resource-group cams-test-rg --name cams-test-vm

# Stop database (keeps data, stops compute billing)
az postgres flexible-server stop \
  --resource-group cams-test-rg --name cams-db

# Paused cost: ~$10/mo (disk + storage only)

# Start again:
az vm start --resource-group cams-test-rg --name cams-test-vm
az postgres flexible-server start --resource-group cams-test-rg --name cams-db
```
