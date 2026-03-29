# CAMS — Azure Deployment Guide (Testing)

## Prerequisites
- Azure account with an active subscription
- Azure CLI installed locally (`az login`) OR use Azure Portal

---

## Step 1 — Create Resource Group

**Azure Portal**: Search "Resource groups" → Create
- **Name**: `cams-test-rg`
- **Region**: `Australia Southeast` (Melbourne)

**Or CLI**:
```bash
az group create --name cams-test-rg --location australiasoutheast
```

---

## Step 2 — Create Virtual Machine

**Azure Portal**: Search "Virtual machines" → Create → Azure virtual machine

| Setting | Value |
|---------|-------|
| Resource group | `cams-test-rg` |
| VM name | `cams-test-vm` |
| Region | `Australia Southeast` |
| Image | `Ubuntu Server 24.04 LTS - x64 Gen2` |
| Size | `Standard_B2s` (2 vCPU, 4 GB RAM) — ~$50 AUD/mo |
| Authentication | SSH public key (recommended) or password |
| Username | `azureuser` |
| Inbound ports | SSH (22) |

**Or CLI**:
```bash
az vm create \
  --resource-group cams-test-rg \
  --name cams-test-vm \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard
```

---

## Step 3 — Open Firewall Ports

**Azure Portal**: VM → Networking → Add inbound port rule

| Port | Service |
|------|---------|
| 3001 | Approval Portal (frontend) |
| 3000 | Applicant Portal (if needed) |
| 8000 | API / Swagger docs |

**Or CLI**:
```bash
az vm open-port --resource-group cams-test-rg --name cams-test-vm --port 3001 --priority 1001
az vm open-port --resource-group cams-test-rg --name cams-test-vm --port 3000 --priority 1002
az vm open-port --resource-group cams-test-rg --name cams-test-vm --port 8000 --priority 1003
```

---

## Step 4 — Get the Public IP

**Portal**: VM overview page → Public IP address

**Or CLI**:
```bash
az vm show -d --resource-group cams-test-rg --name cams-test-vm --query publicIps -o tsv
```

Note the IP (e.g. `20.211.xx.xx`)

---

## Step 5 — SSH and Install (one command)

```bash
ssh azureuser@20.211.xx.xx
```

Then run the setup script (one line — does everything):

```bash
curl -fsSL https://raw.githubusercontent.com/arad71/cams/feature/db-rules-refactor/setup-azure.sh | bash
```

This script will:
1. Install Docker
2. Clone the CAMS repo
3. Create `.env` with default config
4. Build and start all containers
5. Wait for database seed to complete
6. Print the URL and login credentials

**Takes about 5 minutes.** When it finishes you'll see:

```
═══════════════════════════════════════════════════
  ✅ CAMS is running!
═══════════════════════════════════════════════════

  Approval Portal:  http://20.211.xx.xx:3001
  API Docs:         http://20.211.xx.xx:3001/api/docs

  Test Logins:
    Admin:     m.thompson@kalamunda.wa.gov.au  /  admin123
    Manager:   k.williams@kalamunda.wa.gov.au  /  manager123
    Engineer:  s.patel@kalamunda.wa.gov.au     /  engineer123
```

**Optional — add your Anthropic API key** (for AI site plan analysis):
```bash
cd ~/cams
nano .env
# Set ANTHROPIC_API_KEY=sk-ant-your-key-here
sudo docker compose -f docker-compose.prod.yml restart approval-api
```

---

## Step 6 — Verify

Once logs show the seed completed:

```bash
# Check all services are running
docker compose -f docker-compose.prod.yml ps

# Should show:
#   approval-db        running (healthy)
#   approval-api       running
#   approval-frontend  running
#   cams-cron          running
```

Open in browser: `http://20.211.xx.xx:3001`

---

## Step 7 — Share with Test Team

Send this to your team:

```
CAMS Test Environment (Azure)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Approval Portal:  http://20.211.xx.xx:3001
API Docs:         http://20.211.xx.xx:3001/api/docs

Test Accounts:
  Admin:     m.thompson@kalamunda.wa.gov.au  /  admin123
  Manager:   k.williams@kalamunda.wa.gov.au  /  manager123
  Engineer:  s.patel@kalamunda.wa.gov.au     /  engineer123
  Engineer:  j.morrison@kalamunda.wa.gov.au  /  engineer123
  Manager:   r.singh@kalamunda.wa.gov.au     /  manager123

Features to test:
  ✓ Login → Dashboard → Application list
  ✓ Click application → Assessment page
  ✓ Upload site plan PDF → AI extraction
  ✓ Measure tool on PDF → Save to AI field
  ✓ AI checklist → 70 items, 206 rules
  ✓ Map → Sight Analysis (corner lot auto-detect)
  ✓ 3D Analysis with terrain + street view
  ✓ Admin → System Settings → Assessment Rules
```

---

## Maintenance Commands

```bash
# SSH into server
ssh azureuser@20.211.xx.xx

# Go to project
cd cams

# Pull latest code and rebuild
git pull origin feature/db-rules-refactor
docker compose -f docker-compose.prod.yml up -d --build

# Reseed assessment rules (after rule changes)
docker compose -f docker-compose.prod.yml exec approval-api \
  python -c "from app.seed import run_seed; run_seed()"

# View logs
docker compose -f docker-compose.prod.yml logs -f approval-api
docker compose -f docker-compose.prod.yml logs -f approval-frontend

# Reset database (fresh start — deletes all data)
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --build

# Stop everything (keeps data)
docker compose -f docker-compose.prod.yml down

# Start again
docker compose -f docker-compose.prod.yml up -d
```

---

## Cost Control

| Resource | Monthly Cost (AUD) |
|----------|-------------------|
| B2s VM (2 vCPU, 4GB) | ~$50 |
| 32GB managed disk | ~$5 |
| Public IP | ~$5 |
| Bandwidth (minimal) | ~$2 |
| **Total** | **~$62/mo** |

**To reduce cost when not testing:**
```bash
# Deallocate VM (stops billing for compute, keeps disk)
az vm deallocate --resource-group cams-test-rg --name cams-test-vm

# Start VM again when needed
az vm start --resource-group cams-test-rg --name cams-test-vm
```
When deallocated you only pay for disk (~$5/mo).

**To destroy everything:**
```bash
az group delete --name cams-test-rg --yes --no-wait
```

---

## Optional — Entra ID SSO (Microsoft Login)

If you want test team to use their Microsoft 365 accounts:

1. **Azure Portal** → App registrations → New registration
   - Name: `CAMS Test`
   - Redirect URI: `http://20.211.xx.xx:3001/`
   - Supported account types: Single tenant

2. **API permissions**: Add `openid`, `profile`, `email`

3. **Certificates & secrets**: Create a client secret

4. **Update .env** on the VM:
```bash
ENTRA_ENABLED=true
ENTRA_TENANT_ID=your-tenant-id
ENTRA_CLIENT_ID=your-app-client-id
ENTRA_CLIENT_SECRET=your-secret-value
ENTRA_REDIRECT_URI=http://20.211.xx.xx:3001/
ENTRA_AUTO_CREATE_USER=true
ENTRA_DEFAULT_ROLE=engineer
```

5. Restart: `docker compose -f docker-compose.prod.yml up -d`
