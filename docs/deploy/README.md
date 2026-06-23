# Déploiement CI/CD — configuration à faire plus tard

> **État actuel** : squelette Plan A (Docker + GHCR) créé, **non activé**.  
> Le déploiement manuel reste [`vm-rsync-build`](../../.cursor/skills/vm-rsync-build/SKILL.md) jusqu’à la fin de la checklist ci-dessous.

Plan détaillé : [`ci-cd-plan.md`](./ci-cd-plan.md)

---

## Checklist avant activation

### 1. GitHub

- [ ] Repo sur GitHub (org `cocoparks` ou équivalent)
- [ ] Branches `main` (prod) et `develop` (staging)
- [ ] Branch protection : PR obligatoire, checks `ci` verts
- [ ] Environment GitHub `production` avec approbation manuelle (optionnel)

### 2. Secrets GitHub (Settings → Secrets and variables → Actions)

| Secret | Description |
|--------|-------------|
| `SSH_PRIVATE_KEY` | Clé SSH déploy (accès VM) |
| `VM_HOST` | IP VM — ex. `34.38.103.122` |
| `VM_USER` | Utilisateur SSH — ex. `youssouf_sagaf` |
| `VITE_MAPBOX_TOKEN` | Token Mapbox (build frontend) |
| `VITE_FIREBASE_API_KEY` | Firebase |
| `VITE_AUTH_DOMAIN` | Firebase |
| `VITE_DATABASE_URL` | Firebase |
| `VITE_PROJECT_ID` | Firebase |
| `VITE_STORAGE_BUCKET` | Firebase |
| `VITE_MESSAGING_SENDER_ID` | Firebase |
| `VITE_ID` | Firebase app id |
| `VITE_MEASUREMENT_ID` | Firebase analytics |
| `VITE_B2B_BASE_URL` | API B2B — ex. `https://backend-b2b.prod.cocoparks.io/api/v1` |
| `GHCR_IMAGE` | Image complète — ex. `ghcr.io/cocoparks/autocalib` |

Variables (non secrètes) optionnelles : `VM_DEPLOY_PATH` (défaut `~/autocalib`).

### 3. VM GCP (`SELF_IMPROVING_YOLO_PIPELINE_VM`)

- [ ] Docker + Docker Compose installés
- [ ] Dossiers :
  ```bash
  mkdir -p ~/autocalib/sessions ~/autocalib/sessions-staging ~/autocalib/data/huggingface-cache
  ```
- [ ] Copier les fichiers compose + scripts (via git clone ou rsync) :
  - `docker-compose.yml` (dev / manuel actuel)
  - `docker-compose.prod.yml` (staging + prod GHCR)
  - `scripts/deploy-vm.sh`
- [ ] Créer **sur la VM** (jamais commités) :
  - `~/autocalib/.env` → prod (port 8000)
  - `~/autocalib/.env.staging` → staging (port 8001)
  - Modèles : [`.env.example`](../../.env.example), [`.env.staging.example`](../../.env.staging.example)
- [ ] Firewall GCP : TCP **8000** (prod) et **8001** (staging)

### 4. GHCR (GitHub Container Registry)

- [ ] Remplacer `REPLACE_ORG` dans `docker-compose.prod.yml` par l’org GitHub réelle
- [ ] Package `ghcr.io/<org>/autocalib` : visibilité + droits `packages: write` pour Actions
- [ ] Premier push manuel ou via workflow une fois les secrets OK

### 5. Activer les workflows

Dans chaque fichier `.github/workflows/*.yml`, décommenter les blocs `on:` marqués `SCAFFOLD` :

| Fichier | Déclencheur à activer |
|---------|----------------------|
| `ci.yml` | `pull_request` → `develop`, `main` |
| `deploy-staging.yml` | `push` → `develop` |
| `deploy-production.yml` | `push` → `main` |

Puis commit + push sur GitHub.

### 6. Smoke tests

```bash
# Staging
curl -sf http://<VM_IP>:8001/health

# Prod
curl -sf http://<VM_IP>:8000/health
```

### 7. Rollback (prod)

```bash
ssh VM 'cd ~/autocalib && IMAGE_TAG=prod-<ancien-sha> ./scripts/deploy-vm.sh prod'
```

---

## Fichiers du squelette

| Fichier | Rôle |
|---------|------|
| `.github/workflows/ci.yml` | Build frontend + pytest (PR) |
| `.github/workflows/deploy-staging.yml` | Build image → GHCR → VM :8001 |
| `.github/workflows/deploy-production.yml` | Build image → GHCR → VM :8000 |
| `docker-compose.prod.yml` | Services staging/prod depuis registry |
| `scripts/deploy-vm.sh` | Pull + up + healthcheck sur la VM |
| `.env.example` / `.env.staging.example` | Templates variables |

---

## En attendant

Déploiement manuel inchangé :

```bash
rsync … SELF_IMPROVING_YOLO_PIPELINE_VM:~/autocalib/
ssh SELF_IMPROVING_YOLO_PIPELINE_VM 'cd ~/autocalib && docker compose up --build -d'
```

Rebuild forcé frontend : `docker compose build --no-cache autocalib`.
