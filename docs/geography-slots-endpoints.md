# Endpoints `/geography/slots` — `backend-b2b`

Source : `user-interface-data-system/backend-b2b/app/api/routes/geography.py`
Prefix monté dans `routes/api.py` → `prefix="/geography"`, tag `Geography`.
Base URL prod : `https://backend-b2b.prod.cocoparks.io/api/v1/geography/...`

---

## 1. `POST /geography/slots` — Création de slots (absolute map)

### Description
Crée des slots dans l'absolute map. Itère sur le dict reçu, ignore les entrées `slot_type == "to_delete"`, déduplique par `(lat, lng)`, puis génère un vrai `slot_id` (uuid4) côté `cocoparks_python` et insère `static_data` + `dynamic_data` dans Supabase (v3) ou Firestore (v1).

### Payload
`dict[str, dict]` — la clé extérieure est un id temporaire côté front (jetée côté backend, renommée `dummy_id`).

```json
{
  "<temp_id>": {
    "slot_id": "<temp_id>",
    "location": { "lat": 48.8566, "lng": 2.3522 },
    "slot_type": "common",
    "client_id": "abcd1234"
  }
}
```

| Champ | Type | Notes |
|---|---|---|
| `slot_id` | `str` | id temporaire, **supprimé** côté backend |
| `location` | `{ lat: float, lng: float }` | requis |
| `slot_type` | `ControlledSlotTypes` | enum (`common`, `pmr`, `forbidden`, `scooter`, `evh`, `delivery_only`, `bike`, `bus_stop`, `taxi`, `short_duration`, `delivery_dotted`, `trolley`, `pole`). `to_delete` → entrée ignorée |
| `client_id` | `str \| null` | `null` si slot non alloué |

### Réponse
`200 OK`, body vide.

### Appelants
- **Cocopilot-FE** — page **Absolute Map Internal** : `Cocopilot-FE/src/pages/absoluteMapInternal/absoluteMapSection/absoluteMapSection.tsx:514`. Création de slots après dessin sur la carte par le staff.
- **sensors-service** — connecteur Requea : `user-interface-data-system/sensors-service/services/requea_service.py:125` (`create_slot(lat, lng, slot_type)`). Création automatique liée à un sensor.

---

## 2. `GET /geography/slots` — Lecture de tous les slots

### Description
Retourne tous les slots **static data** (avec `slot_id`, `street`, `parking`, `zones` quand pertinents). Côté v3, c'est `SupabaseDatabaseInterface.get_all_slots_static_stream()` qui retourne `slot.model_dump()` + champs format Firestore.

**Catalogue global** — pas de filtre sur cet endpoint. **Autocalib** n’utilise ce GET que pour les villes démo (slots sans `client_id`), via filtre géo autour du crop.

Pour un **client B2B enregistré** (id Firestore), autocalib appelle plutôt :

- `GET /clients/{client_id}/slots?check_event=false` — même champs slot, paginé côté B2B (`get_all_slots_static_by_client`), ordre de grandeur **~100× plus léger** qu’un GET catalogue complet.

Cache TTL (`B2B_SLOTS_CACHE_TTL_SEC`, défaut 90 s) **par scope** (global vs `client_id`) ; filtre crop via `filter_prod_slots_for_client` ; invalidation du scope client après PUT/POST sync.

### Réponse
```json
{ "results": [ { "slot_id": "...", "location": {...}, "slot_type": "...", "street": "...", "parking": "...", ... }, ... ] }
```

### Appelants
Tous via le store Redux `parkingSlotsActions.getAllGeographySlots()` (`Cocopilot-FE/src/store/parking-slots-slice/api.ts:18`). Pages qui dispatchent l'action :

- Roads (table) — `Cocopilot-FE/src/pages/roads/roads.tsx:23`
- Roads modal — `Cocopilot-FE/src/pages/roads/roadsModal/roadsModal.tsx:45`
- Street modal — `Cocopilot-FE/src/pages/roads/streetModal/streetModal.tsx:54`
- LVZ mapping — `Cocopilot-FE/src/pages/lvz-mapping/contentSection/contentSection.tsx:296`
- Single cocospot — calibration — `Cocopilot-FE/src/pages/single-cocospot/calibration/steps/selectMarkerStep/selectMarkerStep.tsx:62`
- Zone details — `Cocopilot-FE/src/pages/zone-details/index.tsx:48`

Usage commun : récupérer **tous** les slots pour les afficher / les associer à une rue, zone, LVZ ou cocospot.

**Autocalib** (via proxy `autocalib-api`, pas d’appel B2B direct depuis le navigateur) :

- `POST /api/v1/clients/{id}/slots/sync` puis worker async → GET catalogue (cache) → PUT/POST ;
- `GET /api/v1/clients/{id}/slots/sync/{sync_id}` — statut de la sync ;
- `GET /api/v1/clients/{id}/reference-slots` — overlay prod filtré.

Voir [`integration.md`](integration.md) §7 et [`autocalib-api/plan_architecture.md`](autocalib-api/plan_architecture.md).

---

## 3. `GET /geography/{entity}/slots?eid=<id>` — Slots d'une entité

### Description
Retourne les slots **(static data)** appartenant à une entité (`street`, `zone`, `parking`, `lvz`). Pour `zone`, agrège les slots des `streets` sous-jacentes. Implémentation : `get_entity_slots_ids` → `get_geography_slots(slots_ids=...)`.

### Paramètres
- Path : `entity` ∈ {`street`, `zone`, `parking`, `lvz`}
- Query : `eid` — id de l'entité

### Appelants
Aucun consommateur trouvé dans le repo (ni Cocopilot-FE, ni autres services uids). **Endpoint probablement orphelin / dead code.** À vérifier avant nettoyage : il pourrait être consommé par un service externe non versionné ici.

> Note : la fonction `get_entity_slots_ids` est très utilisée en interne (`controllers/entity.py`, `aggregations.py`, `data-aggregation`), mais ces usages **n'appellent pas l'endpoint HTTP**, ils importent directement la fonction Python.

---

## 4. `PUT /geography/slots` — Update de slots (et soft delete)

### Description
Met à jour des slots existants via `update_slots_from_absolute_map`. **Particularité** : si `slot_type == "to_delete"`, le slot est **supprimé** (via `INTERFACE.delete_slot`) — c'est le canal de suppression "officiel" depuis l'UI.

### Payload
`dict[slot_id, slot_data]` — ici la clé **est** le vrai `slot_id`.

```json
{
  "<slot_id>": {
    "slot_id": "<slot_id>",
    "location": { "lat": 48.8566, "lng": 2.3522 },
    "slot_type": "pmr"
  }
}
```

Le champ `slot_id` interne est supprimé côté backend (toujours utiliser la clé du dict).

### Réponse
`200 OK`, body vide.

### Appelants
- **Cocopilot-FE — Absolute Map** : `Cocopilot-FE/src/pages/absoluteMap/absoluteMapSection/absoluteMapSection.tsx:153`. Édition des slots d'un client (changement de `slot_type` sur une cocospot view).
- **Cocopilot-FE — Absolute Map Internal** : `Cocopilot-FE/src/pages/absoluteMapInternal/absoluteMapSection/absoluteMapSection.tsx:513`. Édition staff de l'absolute map (sélection polygone + change type / `to_delete`). Appelé avant le `POST` pour les modifs sur slots existants.

---

## 5. `DELETE /geography/slots` — Idem PUT

### Description
**Pointe vers la même fonction** que le PUT (`update_slots_from_absolute_map`). Body attendu identique.

### Appelants
**Aucun** consommateur trouvé dans le repo. La suppression réelle passe par le PUT avec `slot_type = "to_delete"`. Endpoint redondant, candidat à suppression.

---

## Résumé du flux backend

```
POST/PUT/DELETE /geography/slots
        │
        ▼
backend-b2b/app/connectors/data_requests.py
  ├─ POST  → create_absolute_map(slots)       → deduplicate + INTERFACE.create_absolute_map_slot
  └─ PUT   → update_slots_from_absolute_map   → INTERFACE.update_absolute_map_slot
              (sauf slot_type == "to_delete"  → INTERFACE.delete_slot)
        │
        ▼
cocoparks_python (v3 / coconnector)
  ├─ create_absolute_map_slot  → static_data + dynamic_data (Supabase / Firestore)
  ├─ update_absolute_map_slot  → static_data + dynamic_data (slot_type only)
  └─ delete_slot               → delete in 3 collections (static, dynamic, geography)
```

## Notes de vigilance

- Les deux pages **Absolute Map** et **Absolute Map Internal** de Cocopilot-FE sont les seuls vrais clients UI ; cohérence du payload côté front recommandée si tu modifies les modèles Pydantic.
- L'endpoint `GET /geography/{entity}/slots` semble inutilisé — vérifier les logs avant suppression.
- `DELETE /geography/slots` partage le même handler que `PUT` mais n'est appelé par personne — idem, candidat à suppression.
- Le `slot_id` envoyé dans le body est **toujours ignoré** côté backend (au profit de la clé du dict ou d'un uuid4 généré).
