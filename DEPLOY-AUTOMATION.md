# Deploying with the GitHub "Deploy" button

Once set up, deploying is:

**GitHub → Actions → Deploy → Run workflow → choose `test` or `production` → Run workflow**

The workflow:

1. Refuses to deploy unless CI passed on the latest `master` commit.
2. On the chosen VM, checks out exactly that commit in `/opt/cams`. It stops if someone has edited tracked files on the server.
3. Runs `./update.sh --no-pull`, which rebuilds and restarts the containers, then checks `/api/health` both inside the API container and through the frontend.
4. If the health check fails, it rebuilds and restarts the previous version, and the run shows as failed.

Nothing deploys automatically on merge. Data, uploads and GeoJSON files are not touched, as with `update.sh`.

The job runs on a **self-hosted GitHub Actions runner** installed on each VM. The runner connects *out* to GitHub, so no inbound SSH port has to be opened.

---

## 0. Before anything else: protect the runners (public repo)

This repository is public. On a public repo, a pull request from a fork can add a workflow that asks for a self-hosted runner, and that code would then run on your VM, with Docker access. Do **one** of these first:

- **Recommended:** make the repository private. GitHub → Settings → General → Danger Zone → Change visibility.
- Or: GitHub → Settings → Actions → General → *Fork pull request workflows from outside collaborators* → **Require approval for all outside collaborators**. Then never approve a fork's workflow run without reading it.

## 1. Prepare each VM (once per VM)

SSH in and run:

```bash
# A dedicated, non-root user for the runner, allowed to use Docker
sudo useradd -m -s /bin/bash cams-deploy
sudo usermod -aG docker cams-deploy

# Let it own the checkout (setup-azure.sh created /opt/cams as root)
sudo chown -R cams-deploy:cams-deploy /opt/cams

# Swap prevents out-of-memory during npm builds on small VMs (update.sh
# only creates it when run as root, so create it once here)
[ -f /swapfile ] || { sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab; }
```

## 2. Install the runner (once per VM)

1. In GitHub: **Settings → Actions → Runners → New self-hosted runner → Linux, x64**. Keep that page open: it shows the download commands and a one-time registration token.
2. On the VM, as the runner user:

   ```bash
   sudo -iu cams-deploy
   mkdir actions-runner && cd actions-runner
   # paste the "Download" commands from the GitHub page here (curl ... && tar xzf ...)

   # Test VM:
   ./config.sh --url https://github.com/arad71/cams --token <TOKEN-FROM-PAGE> \
     --name cams-test-vm --labels cams-test --unattended
   # Production VM (use this line instead):
   #   ./config.sh --url https://github.com/arad71/cams --token <TOKEN-FROM-PAGE> \
   #     --name cams-production-vm --labels cams-production --unattended
   exit
   ```

3. Run it as a service, so it survives reboots:

   ```bash
   cd /home/cams-deploy/actions-runner
   sudo ./svc.sh install cams-deploy
   sudo ./svc.sh start
   ```

The runner then shows as **Idle** under Settings → Actions → Runners. The label must be exactly `cams-test` or `cams-production`.

## 3. Optional settings in GitHub

- **Different install folder:** Settings → Environments → `test` / `production` → *Environment variables* → add `DEPLOY_DIR` (default `/opt/cams`). The environments appear after the first run; you can also create them beforehand.
- **A second person must approve production deploys:** Settings → Environments → `production` → *Required reviewers*.

## Using it

- **Deploy:** Actions → Deploy → Run workflow → choose the environment. Tick *Rebuild images from scratch* only if a normal deploy misbehaves after a dependency change.
- **A failed run** shows the API logs in the "Build, restart and health-check" step. If it rolled back, the previous version is running again.
- **Manual updates still work:** `./update.sh` on the server behaves as before, except that it now stops if `git pull` or the health check fails.
- **Removing a runner:** Settings → Actions → Runners → the runner → Remove, then on the VM run `sudo ./svc.sh uninstall`.
