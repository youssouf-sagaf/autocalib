# Autoabsmap — Plan de développement complet

## État actuel (snapshot)

| Composant | Statut |
|---|---|
| `config/settings.py` | ✅ Complet |
| `io/geotiff.py`, `io/atomic.py` | ✅ Complet |
| `imagery/` (protocols, mapbox, ign, geotiff_file) | ✅ Complet |
| `ml/` (protocols, models, segmentation, detection) | ✅ Complet |
| `export/` (models, geojson) | ✅ Complet |
| `generator_engine/postprocess.py` | ✅ Complet |
| `generator_engine/models.py` | ✅ Complet |
| `generator_engine/stages.py` | ✅ Complet |
| `generator_engine/runner.py` | ✅ Squelette — pipeline câblé mais sans GeometricEngine |
| `generator_engine/geometric_engine.py` | ⬜ Stub (pass-through + TODO) |
| `reprocessing_helper/` | ⬜ Models OK, `reprocessor.py` stub |
| `alignment_tool/` | ⬜ Models OK, `straightener.py` stub |
| `learning_loop/capture.py` | ✅ Complet |
| `learning_loop/dataset_builder.py` | ⬜ Stub |
| `learning_loop/benchmark.py` | ⬜ Stub |
| `autoabsmap-api/` routes + orchestrator | ✅ Jobs/sessions réels, reprocess/straighten stubs |
| `autoabsmap-frontend/` | ⬜ Inexistant |
| `tests/` (pytest autoabsmap) | ⬜ Golden data présente, aucun test exécutable |

---

## Phases de développement

Le plan suit l'ordre de dépendance naturel : fondations → moteur cœur → engines secondaires → API → frontend → boucle d'apprentissage. Chaque phase se termine par une gate de validation (tests verts, parité R&D vérifiée).

---

### Phase 0 — Tests unitaires sur les fondations existantes

**Objectif :** couvrir les fondations déjà implémentées avant de construire dessus. Filet de sécurité contre les régressions.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 0.1 | Setup pytest + conftest avec fixtures partagées (masques synthétiques, GeoTIFF fake, settings par défaut) | `tests/conftest.py` | `pytest --co` liste les fixtures |
| 0.2 | Tests `io/geotiff.py` : read, crop_by_bounds, crop_by_pixels, GeoRasterSlice.gsd_m cohérent avec affine | `tests/test_io_geotiff.py` | Parité avec R&D `tests/test_io_geotiff.py` |
| 0.3 | Tests `io/atomic.py` : écriture atomique JSON + GeoTIFF (vérifier tmp → rename) | `tests/test_io_atomic.py` | Fichier valide après crash simulé |
| 0.4 | Tests `export/geojson.py` : pixel_slots_to_geoslots, feature_collection schema, write_geojson round-trip | `tests/test_export_geojson.py` | GeoJSON valide, coordonnées WGS84 |
| 0.5 | Tests `generator_engine/postprocess.py` : morph_close_open, fill_small_holes, simplify_mask_boundary sur masques synthétiques | `tests/test_postprocess.py` | Parité avec R&D `test_segmentation_postprocess.py` |
| 0.6 | Tests `generator_engine/stages.py` : chaque stage isolé avec mocks (ImageryProvider, Segmenter, Detector) | `tests/test_stages.py` | Chaque stage retourne le type attendu |
| 0.7 | Tests `config/settings.py` : chargement depuis env vars, valeurs par défaut, validation Pydantic | `tests/test_settings.py` | Settings construites sans env = defaults R&D |

**Plan de test Phase 0 :**
- Fixtures : `fake_georaster_slice` (100×100 RGB, EPSG:3857, affine connue), `default_settings` (toutes valeurs par défaut), `synthetic_mask` (masque binaire avec trous connus).
- Chaque test est pur (pas de réseau, pas de GPU, pas de fichier réel).
- Gate : `pytest tests/ -v` → 100% pass.

---

### Phase 1 — GeometricEngine (Block 3 — cœur du pipeline)

**Objectif :** implémenter le post-traitement géométrique qui transforme les détections brutes YOLO-OBB en slots finaux (row extension, gap fill, dedup, filtrage masque). C'est le module le plus critique — 9/10 en difficulté.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 1.1 | Extraire les magic numbers du R&D `geometric_engine.py` → valider que `GeometrySettings` les couvre tous | `config/settings.py` | Chaque constante R&D a un champ Settings |
| 1.2 | Implémenter `_estimate_row_direction` : analyse des angles médians des voisins + clustering directionnel | `generator_engine/geometric_engine.py` | Test unitaire sur grille régulière de slots |
| 1.3 | Implémenter `_extend_rows` : corridor walk bidirectionnel depuis chaque seed slot, pitch estimé, angle rolling | `generator_engine/geometric_engine.py` | Sur une rangée de 10 slots avec 2 trous → les trous sont remplis |
| 1.4 | Implémenter `_fill_gaps` : slots synthétiques dans les zones masque=1 sans détection, guidés par rangées voisines | `generator_engine/geometric_engine.py` | Zone masque vide adjacente à une rangée → slots générés |
| 1.5 | Implémenter `_deduplicate` : IoU-based dedup (seuil configurable dans GeometrySettings) | `generator_engine/geometric_engine.py` | Deux OBB avec IoU > seuil → un seul survit |
| 1.6 | Implémenter `_filter_outside_mask` : éliminer les slots dont le centre tombe hors du masque segmentation | `generator_engine/geometric_engine.py` | Slot hors masque → supprimé |
| 1.7 | Assembler `GeometricEngine.process()` : chaîne complète (row extend → gap fill → dedup → filter) | `generator_engine/geometric_engine.py` | Appel de bout en bout sur données synthétiques |
| 1.8 | Intégrer dans `ParkingSlotPipeline.run()` : brancher GeometricEngine entre detect et export | `generator_engine/runner.py` | Pipeline retourne `baseline_slots` (avant) + `slots` (après) |
| 1.9 | Parité golden files : comparer sortie GeometricEngine sur les 7 golden cases vs R&D `detections_post.json` | `tests/test_geometric_engine_parity.py` | Slot count delta < 5%, mean matched-pair IoU > seuil |

**Plan de test Phase 1 :**
- **Unitaires (1.2–1.6)** : grilles synthétiques de `PixelSlot` avec positions/angles connus. Pas de dépendance ML.
- **Intégration (1.7–1.8)** : `ParkingSlotPipeline.run()` avec `GeoTiffFileProvider` + vrais checkpoints sur un GeoTIFF de test.
- **Parité (1.9)** : harness qui charge `tests/golden/case_00x/`, exécute le nouveau `GeometricEngine`, compare `detections_post.json`. Critères : slot count delta, matched-pair IoU, unmatched slots.
- Gate : golden-file tests verts sur les 7 cas.

---

### Phase 2 — Pipeline end-to-end + API robuste

**Objectif :** le pipeline complet fonctionne de bout en bout, l'API gère le cycle de vie des jobs, le SSE streame correctement.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 2.1 | Test E2E pipeline : GeoTIFF local → `ParkingSlotPipeline.run()` → GeoJSON valide avec slots post-GeometricEngine | `tests/test_pipeline_e2e.py` | GeoJSON écrit, schema v1, ≥1 slot |
| 2.2 | Test E2E golden parity : pipeline complet sur golden cases, comparer `export.geojson` | `tests/test_pipeline_parity.py` | Parité R&D sur les 7 cas |
| 2.3 | Vérifier `MultiCropOrchestrator` : 2 crops avec overlap → merge first-crop-wins, IoU dedup | `tests/test_orchestrator.py` | Pas de doublons dans le résultat mergé |
| 2.4 | Test API `POST /jobs` → `GET /jobs/{id}` → `GET /jobs/{id}/result` : cycle complet | `tests/test_api_jobs.py` | Status passe pending → running → done, result contient slots |
| 2.5 | Test SSE streaming : vérifier que OrchestratorProgress est émis pour chaque crop/stage | `tests/test_api_sse.py` | Events SSE parsés, crop_index/crop_total/stage/percent présents |
| 2.6 | Gestion d'erreurs API : crop invalide, job inexistant, timeout pipeline | `tests/test_api_errors.py` | 400/404/500 appropriés, messages structurés |

**Plan de test Phase 2 :**
- **E2E pipeline** : nécessite checkpoints ML (SegFormer + YOLO). Marqués `@pytest.mark.slow` ou `@pytest.mark.gpu`. Skippés en CI si pas de GPU.
- **API** : `httpx.AsyncClient` avec l'app FastAPI en mode test. Mocks pour le pipeline (réponse instantanée).
- Gate : `pytest tests/ -v -m "not slow"` → 100% pass. Tests slow verts sur machine GPU.

---

### Phase 3 — RowStraightener / Alignment Tool (Block 7)

**Objectif :** un opérateur clique un slot → la rangée entière est détectée et alignée.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 3.1 | Implémenter `_find_neighbors` : K plus proches voisins par distance centroïde | `alignment_tool/straightener.py` | 4–6 voisins retournés, triés par distance |
| 3.2 | Implémenter `_estimate_corridor` : direction médiane des voisins → rectangle orienté | `alignment_tool/straightener.py` | Corridor aligné avec la rangée sur grille test |
| 3.3 | Implémenter `_walk_corridor` : walk bidirectionnel avec rolling angle update, stop conditions (gap, angle break) | `alignment_tool/straightener.py` | Rangée de 8 slots → 8 collectés. T-intersection → seule la bonne rangée |
| 3.4 | Implémenter `_apply_correction` : angle médian → rotation OBB, snap centroids sur axe fitted | `alignment_tool/straightener.py` | Slots post-correction alignés (variance latérale < seuil) |
| 3.5 | Assembler `RowStraightener.straighten()` : pipeline complet neighbors → corridor → walk → correct | `alignment_tool/straightener.py` | Test sur lot synthétique avec wobble → wobble éliminé |
| 3.6 | Brancher route API `POST /jobs/{id}/straighten` sur l'implémentation réelle | `autoabsmap-api/app/routes/straighten.py` | Requête avec slot_id → corrected_slots non vides |

**Plan de test Phase 3 :**
- **Unitaires (3.1–3.4)** : lots synthétiques de `GeoSlot` avec positions/angles perturbés.
- **Edge cases** : rangée très courte (2 slots), slot isolé (→ résultat vide), T-intersection, lot en angle.
- **Intégration (3.6)** : test API avec `httpx`, vérifie que les slots retournés ont le bon angle.
- Gate : tous les edge cases du tableau architecture V1 couverts.

---

### Phase 4 — ReprocessingHelper (Block 6)

**Objectif :** l'opérateur place un slot de référence + dessine une zone → auto-fill des slots manqués.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 4.1 | Implémenter `_extract_pattern` : orientation, width, length, spacing depuis le slot de référence + voisin le plus proche | `reprocessing_helper/reprocessor.py` | Pattern extrait cohérent avec le slot de ref |
| 4.2 | Implémenter `_clip_scope` : intersection scope polygon × masque segmentation | `reprocessing_helper/reprocessor.py` | Zone clippée = parkable seulement |
| 4.3 | Implémenter `_row_extension_in_scope` : marche bidirectionnelle guidée par le pattern, confinée au scope clippé | `reprocessing_helper/reprocessor.py` | Slots générés dans le scope, pas en dehors |
| 4.4 | Implémenter `_dedup_against_existing` : IoU > 0.5 contre existing_slots → discard | `reprocessing_helper/reprocessor.py` | Aucun doublon avec les slots existants |
| 4.5 | Assembler `ReprocessingHelper.reprocess()` | `reprocessing_helper/reprocessor.py` | Test E2E : ref slot + scope vide → slots proposés |
| 4.6 | Brancher route API `POST /jobs/{id}/reprocess` sur l'implémentation réelle | `autoabsmap-api/app/routes/reprocess.py` | Requête → proposed_slots non vides |

**Plan de test Phase 4 :**
- **Unitaires** : scope rectangulaire sur un masque connu, ref slot positionné. Vérifier nombre de slots, espacement régulier, aucun slot hors scope.
- **Dedup** : ajouter un existing_slot qui overlap → vérifier qu'il n'y a pas de doublon.
- **Sans masque** : `seg_mask=None` → scope entier rempli.
- Gate : tests unitaires + test API intégration verts.

---

### Phase 5 — Learning Loop complet (Block 4)

**Objectif :** capture complète des sessions, construction de datasets, benchmark de modèles candidats.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 5.1 | Valider `SessionStore.save()` : vérifier la structure de fichiers générée (run_meta, edit_trace, per_crop, delta_summary) | `tests/test_capture.py` | Structure fichier conforme au layout architecture |
| 5.2 | Implémenter `DatasetBuilder.build_segmentation_dataset()` : extraire masques + signals FN/FP depuis sessions | `learning_loop/dataset_builder.py` | Dataset non vide à partir d'une session simulée |
| 5.3 | Implémenter `DatasetBuilder.build_detection_dataset()` : extraire FN (adds manuels), FP (deletes), corrections géométriques | `learning_loop/dataset_builder.py` | Séparation correcte des signals par source |
| 5.4 | Implémenter `BenchmarkRunner.run()` : re-run pipeline sur sessions historiques, comparer KPIs | `learning_loop/benchmark.py` | BenchmarkReport avec primary_kpi_delta calculé |
| 5.5 | Brancher route API `POST /sessions/{id}/save` : forward vers B2B `PUT /geography/slots` (TODO actuel) | `autoabsmap-api/app/routes/sessions.py` | Save local OK + appel B2B (mock en test) |
| 5.6 | Tests KPI : vérifier les formules (effort, FP rate, FN rate, geometric correction rate) | `tests/test_kpi.py` | Calculs corrects sur données synthétiques |

**Plan de test Phase 5 :**
- **Capture** : créer une `SessionTrace` synthétique, sauver, relire, vérifier intégrité.
- **Dataset builder** : 3 sessions simulées avec adds/deletes/modifications → vérifier que les signals sont correctement séparés (seg vs det).
- **Benchmark** : mocker le pipeline, vérifier que le rapport compare old vs new correctement.
- Gate : KPIs calculés identiques sur données connues.

---

### Phase 6 — Frontend autoabsmap (Blocks 1, 2, 5)

**Objectif :** application React + Vite + Redux Toolkit + Mapbox GL JS — POC fonctionnel.

| # | Tâche | Fichier(s) | Critère de fin |
|---|---|---|---|
| 6.1 | Scaffolding : Vite + React 18 + TypeScript strict + Redux Toolkit + react-map-gl + mapbox-gl-draw | `autoabsmap-frontend/` | `npm run dev` démarre, carte Mapbox visible |
| 6.2 | `IMapProvider` interface + `MapboxGLMapProvider` : syncWith, addSlotLayer, enableMultiRectDraw, fitBounds | `src/map/` | Deux cartes synchronisées dans un layout dual |
| 6.3 | Redux slice `autoabsmap-slice.ts` : state complet (crops, job, slots, selection, editHistory, isDirty) | `src/store/` | Slice chargé, devtools montrent l'état initial |
| 6.4 | Feature `crops/` : dessiner N rectangles en scrollant, gérer la liste des crops | `src/features/crops/` | Dessiner 3 rectangles → `state.crops.length === 3` |
| 6.5 | Feature `hints/` : freehand drawing pour masques hints class A/B | `src/features/hints/` | Dessin freehand → polygon envoyé avec le crop |
| 6.6 | Feature `pipeline/` : trigger job multi-crop, SSE progress bar par crop/stage | `src/features/pipeline/` | Lancer job → progress visible → slots affichés |
| 6.7 | Feature `dual-map/` : layout deux cartes synchronisées | `src/features/dual-map/` | Pan/zoom sur une carte → l'autre suit |
| 6.8 | Feature `slot-layer/` : afficher OBBs + centroids, style par source, tooltip au hover | `src/features/slot-layer/` | Slots visibles, couleurs différentes par source |
| 6.9 | Feature `editing/` : Add / Delete / BulkDelete (lasso) / Modify (drag) | `src/features/editing/` | Chaque opération modifie `state.slots` + enregistre un `EditEvent` |
| 6.10 | Feature `reprocessing/` : sélectionner ref slot + dessiner scope → afficher propositions | `src/features/reprocessing/` | API appelée, slots proposés affichés, confirm/cancel |
| 6.11 | Feature `row-straightener/` : clic sur un slot → preview correction → confirm/cancel | `src/features/row-straightener/` | API appelée, slots corrigés affichés en preview |
| 6.12 | Feature `session/` : undo/redo (editHistory + editIndex), dirty flag | `src/features/session/` | Ctrl+Z / Ctrl+Y fonctionnels |
| 6.13 | Feature `save/` : difficulty tags + save final → API | `src/features/save/` | Save déclenche POST, isDirty revient à false |
| 6.14 | Existing slots overlay : chargement au mount depuis B2B, style muted, read-only | `src/features/slot-layer/` | Slots existants visibles, non éditables |
| 6.15 | API client typé (`autoabsmap-api.ts`) | `src/api/` | Toutes les routes API couvertes avec types TS |
| 6.16 | Build Vite → servir depuis `autoabsmap-api/static/` | `vite.config.ts` | `npm run build` → fichiers dans `static/`, API les sert |

**Plan de test Phase 6 :**
- **Composants** : Vitest + React Testing Library. Chaque feature a au moins un test de rendu + un test d'interaction.
- **Redux** : tests de reducers isolés (dispatch action → vérifier state).
- **E2E** : Playwright ou browser-use — scénario complet : ouvrir l'app → dessiner un crop → lancer le job → éditer un slot → sauver.
- Gate : `npm run test` vert, scénario E2E complet passant.

---