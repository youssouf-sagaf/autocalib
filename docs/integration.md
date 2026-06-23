# autocalib ↔ Cocoparks Ecosystem — Integration Plan

> **Cocopilot UX (deep links, VM)** + **calib/pairing → `static_data`** : voir [`docs/cocopilot-integration-plan.md`](docs/cocopilot-integration-plan.md) (phases C1–C3 prioritaires avant deep links).

> Branchement progressif d'autocalib (operator tooling) sur les sources de
> vérité de l'écosystème Cocoparks. Document à implémenter par étapes — pas
> de big-bang. Toutes les références listées sont vérifiées dans les repos
> voisins (`cocoparks_python`, `Cocopilot-FE`, `user-interface-data-system`).

---

## 1. Ce que l'écosystème nous offre déjà

### 1.1 `cocoparks_python` — la dépendance partagée

Importé par tous les services UIDS comme une lib (sibling repo). Expose :

- **`CocoparksDatabaseInterface`** (`cocoparks/coconnector/interface.py`) — façade Firestore aujourd'hui, **migration v3 / Supabase en cours** (cf. `user-interface-data-system/AGENTS.md` ligne 9). Méthodes utiles :
  - `get_entity('slot' | 'parking' | 'street' | 'zone' | 'lvz', id)`
  - `get_entities(...)` — listing par client
  - `delete_entity` / `update_entity_dynamic_data`
  - `get_visits`, `get_slots_historical_data`, etc.
- **Modèles Pydantic** (`cocoparks/models/`) — sources de vérité :
  - `b2b.B2BClient` — `display_name`, `cocospots: List`, `parkings`, `streets`, `zones`, `device_prefix`, `timezone`, `location`
  - `entities.SlotStaticData` — **`slot_id`, `client_id`, `parking`, `street`, `zones`, `monitored_by`, `camera_id`** ← le pont natif vers autocalib
  - `entities.SlotDynamicData` — `is_free`, `vehicle_type`, `policy_status`
  - `cocospots.CocospotNote`, `visits.Visit`
- **Chemins de collections** (`cocoparks/core/collections_paths.py`) :
  - `CLIENTS_COLLECTION = 'b2b_specific/collections/clients'`
  - `SLOTS_GEOGRAPHY = 'geography/collections/slots'`

### 1.2 `Cocopilot-FE` — pattern de fetch côté front

- Auth : `GET /clients/{userId}` (`store/auth-slice/api.ts:22`) → liste les clients accessibles à l'utilisateur connecté.
- Cocospots : `GET /cocospots`, `/cocospots/{id}/static_data`, `/cocospots/{id}/dynamic_data`, `/cocospots/{id}/version`, `/cocospots/{id}/config` (`store/cocospots-slice/api.ts`).
- Coordonnées via Airtable : `GET /integrators/cocospots/get-coordinates-from-airtable?device_ids=...` — utile si on veut afficher le device sur la carte avant calibration.
- Stats agrégées : `clientAggregationApi` (`api/client-aggregation.ts`) — `/clients/{id}/rolling/{period}`, `/clients/{id}/aggregations/{level}/{period}`.

### 1.3 `user-interface-data-system/backend-b2b`

C'est l'API que Cocopilot-FE consomme. Ses routes (`backend-b2b/app/api/routes/`) sont déjà branchées sur `CocoparksDatabaseInterface`. **On ne va pas la dupliquer côté autocalib** — on la consomme.

---

## 2. Ce qu'autocalib hardcode aujourd'hui (gaps)

| Gap | Endroit | Conséquence |
|------|---------|--------------|
| Liste statique de **17 clients** | `autocalib-frontend/src/features/device-picker/DevicePicker.tsx:6` et `CalibWorkspace.tsx:22-27` | Doublon hors-sync avec Firestore |
| `device_id` saisi en **texte libre** | `DevicePicker.tsx:107` | Aucune validation, typos silencieux |
| `client` envoyé tel quel à S3 | `calib_gen/io/s3_loader.py:45` (`f"{client}/{device_id}/"`) | Doit matcher exactement le préfixe du bucket |
| **`slot_id` éphémère UUID v4** | `autoabsmap/export/models.py:44-51` (commentaire explicite) | Pairing actuelle pointe sur des IDs jetés à la fin du run |
| Aucune référence à `camera_id` / `cocospot_id` | grep retourne 0 hit | Le pont natif `SlotStaticData.camera_id` n'est pas exploité |
| Pairings sauvegardées en JSON local | `pairing/pairing_store/store.py` | Pas de propagation vers Firestore/Supabase |

---

## 3. Stratégie d'intégration — principes

### 3.1 Single point of contact : `cocoparks_python`

**Ne pas** appeler Supabase directement depuis autocalib. La migration v3
est gérée par `cocoparks_python` ; on passe par `CocoparksDatabaseInterface`
et on hérite gratuitement du switch Firestore → Supabase.

```
autocalib-api  →  cocoparks.coconnector.CocoparksDatabaseInterface  →  Firestore | Supabase
```

Précédent existant : `autocalib-api/app/models.py:14` importe déjà
`from autoabsmap.export.models import GeoSlot` — même pattern de sibling
import. Ajouter `cocoparks` est trivial : `pip install -e
../cocoparks_python` (ou path-include dans `requirements.txt`).

### 3.2 Mapping ID → contrat naturel

| Concept autocalib | Champ Cocoparks | Source de vérité |
|--------------------|------------------|--------------------|
| `client` (string) | `B2BClient.client_id` (clé du doc) + `display_name` | `CLIENTS_COLLECTION` |
| `device_id` | **`SlotStaticData.camera_id`** (pour onstreet) ou `cocospot.id` | client doc `.cocospots[]` |
| `slot_id` produit | **`SlotStaticData.slot_id`** existant (clé Firestore stable) | `SLOTS_GEOGRAPHY` |
| `calib_bbox` (`spot_id`, x, y, w, h) | nouveau champ — proposé : `SlotStaticData.calib_bbox: Optional[CalibBbox]` | À ajouter dans `cocoparks_python/models/entities.py` |
| `pairing` (slot ↔ bbox) | déjà naturel : un slot a un `camera_id` + un `calib_bbox` → pairing implicite | Le `PairingLink` actuel devient redondant une fois écrit dans Firestore |

**Conséquence forte :** la table `pairings` séparée que le MVP backend
vient de créer (`pairing/pairing_store/`) **est temporaire**. Cible finale :
écrire le `calib_bbox` directement sur le doc slot, le `camera_id` joue le
rôle de FK.

### 3.3 Front : remplacer hardcode par fetch progressif

Garder `WorkspaceContext` (already in Redux) — juste alimenter ses listes
via thunks au lieu de constantes. Pas de refactor de l'arborescence.

---

## 4. Backlog priorisé

### P0 — Lister les clients depuis la DB *(1-2 j, débloque tout le reste)*

**Backend :**
- Nouvelle route `GET /api/v1/clients` dans `autocalib-api/app/routes/clients.py`.
- Implémentation : `CocoparksDatabaseInterface.get_entities()` côté `b2b_specific/collections/clients` (ou wrapper `list_clients()` à ajouter à `cocoparks_python` si pas déjà présent).
- Réponse minimale : `[{client_id, display_name, device_prefix, timezone, location}]`.

**Frontend :**
- Thunk `fetchClients` dans `autocalib-slice.ts`, payload stocké dans `state.context.availableClients`.
- `DevicePicker.tsx` et `CalibWorkspace.tsx` lisent `state.context.availableClients` au lieu du tableau littéral.
- Garder le hardcode comme fallback pendant la transition (feature flag).

**Cleanup :** supprimer les constantes `CLIENTS = [...]` (deux endroits).

---

### P1 — Lister les devices/cocospots par client *(2-3 j)*

**Backend :**
- Route `GET /api/v1/clients/{client_id}/devices` retournant la liste des `cocospot.id` du doc client + leur `static_data` (location, status).
- Source : `B2BClient.cocospots` + `CocospotNote` enrichies via `/cocospots/{id}/static_data` du backend-b2b si dispo (proxy ou fetch direct via `cocoparks_python`).

**Frontend :**
- Le sélecteur device passe d'un `<input type=text>` à un dropdown searchable peuplé via `fetchDevicesForClient(clientId)`.
- Validation : un device choisi correspond forcément à un cocospot existant.
- Bonus : afficher la location du device pour préremplir le `viewState` de la map (zoom auto).

**Effet de bord positif :** le bug doc'd à `calib_gen/io/s3_loader.py:45`
(`f"{client}/{device_id}/"`) n'a plus d'invalid input possible.

---

### P2 — Réutiliser les `slot_id` Firestore au lieu de UUID éphémères *(3-5 j, gros impact)*

**Backend :**
- `autoabsmap.export.models.GeoSlot.slot_id` cesse d'être éphémère.
- Au démarrage d'un job absmap, charger les `SlotStaticData` existants pour le device (filtre `camera_id == device_id`) → match géométrique entre slots détectés et slots existants → réutiliser leur `slot_id` plutôt qu'en mint des nouveaux.
- Nouveau slot non matché → mint UUID, mais marquer `source='new'` pour suggérer une création côté Cocopilot.

**Frontend :**
- Aucun changement de schéma — `Slot.slot_id` reste `string`. Juste les valeurs deviennent stables.

**Bénéfice :** la pairing devient durable. Les `PairingLink.slotId` sauvegardés pointent enfin sur les bons slots de prod.

---

### P3 — Persister le `calib_bbox` sur le doc slot *(2-3 j, v2 — après static_data)*

**Court terme (plan Cocopilot v1)** : persister les bboxes comme Cocopilot via **`cocospot static_data.calibration`** (`GET`/`POST` proxy dans `autocalib-api`) — voir [`docs/cocopilot-integration-plan.md`](docs/cocopilot-integration-plan.md) phase C. Le pairing Autocalib doit charger ces bboxes, pas seulement `calib_gen` / `pairings/*.json`.

**Côté `cocoparks_python` (PR à pousser dans le repo voisin, plus tard) :**
```python
# cocoparks/models/entities.py — ajout dans SlotStaticData
class CalibBbox(ExcludeModel):
    spot_id: int
    center_x: float
    center_y: float
    x: float; y: float
    width: float; height: float
    n_frames: int
    confidence: float
    saved_at: datetime.datetime

class SlotStaticData(BaseEntityStaticData):
    ...
    calib_bbox: Optional[CalibBbox] = None  # nouveau
```

**Côté autocalib :**
- `pairing/pairing_store/store.py` devient un cache local pour le travail
  en cours, mais l'écriture finale (sur "Save") va dans Firestore via
  `update_entity_dynamic_data` (ou `update_entity_static_data` à ajouter).
- `pairing/models/pairing.py::PairingSet.links` reste pour la transaction
  multi-pairing, mais elle s'évapore dès que le push est fait.

**Migration sans casse :** garder `pairings/<device>.json` pendant 1 sprint
en parallèle, supprimer une fois le push DB validé.

---

### P4 — Reverse direction : utiliser les zones/parkings existants *(R&D, bonus)*

Le workspace absmap définit aujourd'hui des `crops` à la main. Si le device
a déjà des `zones` / `parkings` dans le doc client, on peut **proposer ces
polygones comme crops par défaut** au lancement du job. Pertinent si
l'opérateur calibre un device dans un parking déjà cartographié.

API : `GET /api/v1/clients/{client_id}/zones` (ou réutiliser backend-b2b si
exposé).

---

### P5 — Supabase direct *(post-migration v3, ne pas commencer maintenant)*

Une fois `cocoparks_python` v3 stable et l'interface Supabase publiée :
- Étudier si certains reads chauds (par ex. liste devices) bénéficient
  d'un client Supabase direct (RLS + temps réel).
- Sinon, garder l'abstraction `CocoparksDatabaseInterface` — moins de code à maintenir.

**Anti-pattern à éviter :** ne pas écrire un client Supabase parallèle dans
autocalib qui dupliquerait la logique de `cocoparks_python`. Si manquant,
l'ajouter dans `cocoparks_python` (PR upstream).

---

## 5. Plan d'exécution suggéré

```
Sprint N      Sprint N+1     Sprint N+2     Sprint N+3+
   P0    →      P1      →      P2      →    P3 + cleanup pairing/   →   P4 / P5
fetch       fetch          slot_id        push calib_bbox vers DB
clients     devices        stables
```

Aucune priorité P3+ ne doit démarrer avant P2 (dépendance forte sur la
stabilité des `slot_id`).

---

## 6. Checklist de fichiers à toucher (P0+P1)

**Nouveau :**
- `autocalib-api/app/routes/clients.py`
- `autocalib-api/app/services/cocoparks_repo.py` (façade fine sur `CocoparksDatabaseInterface`)
- `autocalib-frontend/src/api/clients.ts` (ou ajout dans `autocalib-api.ts`)

**Modifié :**
- `autocalib-api/app/main.py` — register router clients
- `autocalib-api/requirements.txt` ou `requirements.in` — ajouter `cocoparks` en sibling install
- `autocalib-frontend/src/store/autocalib-slice.ts` — `fetchClients`, `fetchDevicesForClient` thunks ; étendre `WorkspaceContext`
- `autocalib-frontend/src/features/device-picker/DevicePicker.tsx` — dropdown searchable
- `autocalib-frontend/src/features/calib-editor/CalibWorkspace.tsx` — supprimer `CLIENTS = [...]`
- `autocalib-frontend/src/types/index.ts` — types `ClientSummary`, `DeviceSummary`

**Supprimé :**
- Constantes `CLIENTS = [...]` dans `DevicePicker.tsx:6` et `CalibWorkspace.tsx:22`

---

## 7. Dual-write B2B (implémenté — prod, v3 Supabase)

Cocopilot-FE reste l’outil maître. Autocalib écrit via **autocalib-api → backend-b2b** (pas de Supabase direct, pas d’auth v1).

Référence HTTP : [`geography-slots-endpoints.md`](geography-slots-endpoints.md).

### Flux Save (bouton Absmap) — `POST …/slots/save` synchrone (dirty)

1. Front envoie **dirty only** : nouveaux (`slot_id` vide) + modifiés + `deleted_prod_ids`.
2. `POST /api/v1/clients/{client_id}/slots/save` — **GET** prod → `compute_b2b_delta_dirty` → **1 PUT** + **1 POST** → re-GET overlay.
3. Réponse **200** : `{ results, save_summary }` — le front remplace `state.slots` (pas de poll).
4. Learning-loop : sidecar `SessionStore.save` en arrière-plan si `job_id` + `edit_events`.

**Retiré** : `POST …/slots/sync` + poll → **410 Gone** ; worker async, `pending_sync`, et poll front supprimés.

### Flux Save calib / pairing

1. `POST /api/v1/devices/{id}/calibration` — toutes les bboxes (`slot_id` si apparie, sinon `str(spot_id)`).
2. `calibration.slots` : entrées appariees uniquement ; merge `reset=false` conserve `street_name` / `front_marker` existants.
3. Bboxes **4 ou 8** coords % (rotation Cocopilot) — voir `calib-geometry.ts` / `cocospot_calibration.py`.

Modules :

| Module | Rôle |
|--------|------|
| [`autoabsmap/export/b2b_slots.py`](autoabsmap/export/b2b_slots.py) | Payload POST/PUT (`location`, `slot_type`, `client_id`) |
| [`autoabsmap/export/b2b_delta.py`](autoabsmap/export/b2b_delta.py) | Diff create / update / delete (crops + `removed_prod_slots`) |
| [`autocalib-api/app/services/b2b_geography.py`](autocalib-api/app/services/b2b_geography.py) | Client HTTP + `save_client_slots_dirty` |
| [`autocalib-api/app/services/b2b_slots_cache.py`](autocalib-api/app/services/b2b_slots_cache.py) | Cache catalogue GET (TTL, invalidation après écriture) |
| [`autocalib-api/app/routes/clients.py`](autocalib-api/app/routes/clients.py) | `POST …/slots/save` (sync) ; `…/slots/sync` → 410 |
| [`autocalib-frontend/src/ui/SaveFeedbackModal.tsx`](autocalib-frontend/src/ui/SaveFeedbackModal.tsx) | Modal résumé Save (absmap / calib / pairing) |

### Suppressions

| Action UI | Session | B2B au Save |
|-----------|---------|-------------|
| Delete sur slot session (`−` / Del) | Retiré de `slots` | Si id prod connu → PUT `to_delete` via diff ; sinon rien |
| Delete sur pin gris (prod overlay) | `removedProdSlots` | PUT `to_delete` |

**Périmètre publié vers B2B** (`working_slots_for_b2b` / `slot_publishes_to_b2b`) :

- Slots **dans les ROIs de mapping** (`crop_polygons` du Save) : tout le résultat session (IA + éditions).
- **Hors ROI** : uniquement les slots `source: manual` (outil ADD, tile row).
- **Sans ROI de mapping** : uniquement `manual` — pas de suppression massive du catalogue client.
| Lasso | `bulkDeleteSlots` sur `slots` | Comme delete session |

Les slots supprimés ne sont **pas** envoyés dans `final_slots`.

### Env autocalib-api

| Variable | Défaut | Description |
|----------|--------|-------------|
| `B2B_BASE_URL` | `https://backend-b2b.prod.cocoparks.io/api/v1` | API B2B |
| `B2B_ENABLED` | `true` | `false` → `POST …/slots/save` renvoie 503 |
| `B2B_SLOTS_CACHE_TTL_SEC` | `90` | TTL cache `GET geography/slots` (secondes) |
| `B2B_STAFF_UID` | — | `GET /clients` pour le registre villes → id Firestore |
| `B2B_PUT_BATCH_SIZE` | `20` | Taille des lots `PUT geography/slots` (5xx → split auto en demi-lots) |
| `COCOPARKS_PROD_URL` | — | API ops Cocoparks (inventaire cocospots / villes) |
| `COCOPARKS_PROD_VERIFY_SSL` | `false` | Vérification TLS vers l’API ops |
| `PREWARM_ML_MODELS` | `true` | Préchargement SAM3 au démarrage de l’API |

### Auth (à trancher)

v1 : appels B2B **sans** Bearer. Options futures : JWT opérateur forward, service account, route interne B2B — voir discussion produit.

---

## 8. Liens utiles

- `cocoparks_python/cocoparks/models/b2b.py` — `B2BClient`
- `cocoparks_python/cocoparks/models/entities.py` — `SlotStaticData` (camera_id ligne 104-107)
- `cocoparks_python/cocoparks/coconnector/interface.py` — façade DB
- `cocoparks_python/cocoparks/core/collections_paths.py` — chemins Firestore
- `Cocopilot-FE/src/store/auth-slice/api.ts:22` — pattern `getClients`
- `Cocopilot-FE/src/store/cocospots-slice/api.ts:21` — pattern `cocospotsApi`
- `user-interface-data-system/backend-b2b/app/api/routes/` — routes existantes à éventuellement réutiliser plutôt que dupliquer
- `user-interface-data-system/AGENTS.md:9` — confirmation v3/Supabase migration en cours
