---
name: vm-rsync-build
description: >-
  Deploy autocalib to the remote VM via rsync and Docker Compose rebuild. Use
  when the user asks for rsync, build on the VM, deploy to VM, sync to
  SELF_IMPROVING_YOLO_PIPELINE_VM, or "rsync et build".
---

# VM rsync and build (autocalib)

Deploy from the **repo root** to the GCP VM. Stack listens on **port 8000** (API + built SPA).

## Prerequisites

- SSH host alias **`SELF_IMPROVING_YOLO_PIPELINE_VM`** configured in `~/.ssh/config` (points at `self-improving-yolo-pipeline-vm` or equivalent).
- Remote path: `~/autocalib/`
- Run commands from the user's machine (network + shell access required).

## When to rsync only vs rsync + build

| Change | rsync enough? |
|--------|----------------|
| `sessions/` data on VM only | Yes (volume-mounted) |
| **Frontend**, **API**, **Python packages** (`autocalib-api/`, `autoabsmap/`, etc.) | **No** — code is baked into the image |
| `autocalib-api/config/` | **No** — copied at Docker build |

Default: user asks to **deploy** or **build** → run **both** steps. If they say **rsync only**, sync files but warn that app code changes need a rebuild to take effect.

## Step 1 — Rsync (from repo root)

Use the workspace absolute path as source. Excludes match `AGENTS.md` / `.dockerignore`:

```bash
rsync -avz --delete -e "ssh -o BatchMode=yes -o ConnectTimeout=15" \
  --exclude='.venv' --exclude='node_modules' --exclude='.git' \
  --exclude='sessions' \
  --exclude='data' \
  --exclude='autoabsmap/artifacts' \
  --exclude='logs' \
  "${WORKSPACE_ROOT}/" \
  SELF_IMPROVING_YOLO_PIPELINE_VM:~/autocalib/
```

`--delete` — miroir : un fichier supprimé/renommé en local est aussi supprimé sur la VM, pour que `~/autocalib/` reflète exactement le repo local. **Les dossiers exclus sont protégés** (rsync ne supprime jamais un fichier exclu) : `sessions/`, `logs/`, `autoabsmap/artifacts/`, `.venv`, `node_modules`, `.git` restent intacts sur la VM. Astuce : ajoute `--dry-run` pour voir ce qui serait supprimé avant de lancer pour de vrai.

Replace `${WORKSPACE_ROOT}` with the actual autocalib repo path (e.g. `/Users/youssoufsagaf/work/cocoparks-dev/autocalib/`).

## Step 2 — Build and restart (on VM)

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 \
  SELF_IMPROVING_YOLO_PIPELINE_VM \
  'cd ~/autocalib && docker compose up --build -d && docker image prune -f'
```

- `--build` — rebuild image (Vite frontend + Python API).
- `-d` — detached.
- `docker image prune -f` — supprime l'ancienne image, devenue orpheline (`<none>`) après le rebuild qui réutilise le même tag. Évite l'accumulation d'images qui sature le disque de la VM. **Sans risque** : ne touche que les images dangling, jamais l'image taguée qui vient de démarrer, et garde le cache de build (`docker builder`) pour des rebuilds rapides.

Allow **several minutes** for the first or full rebuild; set a long `block_until_ms` when using the Shell tool (e.g. 600000).

## Step 3 — Verify (optional)

```bash
ssh SELF_IMPROVING_YOLO_PIPELINE_VM 'cd ~/autocalib && docker compose ps'
ssh SELF_IMPROVING_YOLO_PIPELINE_VM 'curl -sf http://localhost:8000/health'
```

Follow logs:

```bash
ssh SELF_IMPROVING_YOLO_PIPELINE_VM 'cd ~/autocalib && docker compose logs -f --tail=100'
```

## GCP instance lookup (optional)

```bash
gcloud compute instances list \
  --filter='name=self-improving-yolo-pipeline-vm' \
  --format='table(name,zone,status)'
```

## Do not sync to the VM

- `.venv/`, `node_modules/`, `.git/`
- `sessions/` (persisted via compose volume on the server)
- `autoabsmap/artifacts/`, `logs/`

## Failure handling

- **rsync SSH failure**: check VPN, host alias, and `BatchMode=yes` (non-interactive key auth).
- **docker build failure**: fetch logs with `docker compose logs` on the VM; fix locally, re-rsync, rebuild.
- **Port 8000 unreachable**: confirm GCP firewall allows inbound TCP 8000 to the instance.

## CI/CD (futur)

Un squelette Plan A (GHCR + GitHub Actions) existe dans `docs/deploy/` — **non activé**. Quand la checklist est faite, le déploiement passera par Actions au lieu de rsync manuel.

## Report back to the user

- rsync: files transferred (or "already up to date")
- build: container recreated/started
- URL hint: `http://<VM_IP>:8000` if IP is known from context
