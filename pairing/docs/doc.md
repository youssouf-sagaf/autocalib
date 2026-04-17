# Pairing — GeoSlot (carte) ↔ Bbox caméra (image)

## Contexte

Le **pairing** est l'étape qui associe chaque place de parking détectée sur la carte aérienne (`GeoSlot`, coordonnées WGS84) à son équivalent dans l'image caméra de surveillance (bbox en coordonnées pixel normalisées, stockées dans `calibration.bboxes`).

C'est le cœur du module `autocalib` : faire le lien entre l'espace géographique et l'espace caméra.

### Deux espaces à mettre en correspondance

| Espace | Source | Coordonnées | Données |
|--------|--------|-------------|---------|
| **Carte (map)** | pipeline `autoabsmap` | WGS84 (`GeoSlot.center`, `GeoSlot.polygon`) | Polygones OBB aériens |
| **Caméra (image)** | Modèle de détection + corrections manuelles | Pixels normalisés (`[x1,y1,x2,y2,...]` dans `calibration.bboxes`) | Bboxes vues par la caméra |

### Difficulté fondamentale

La caméra a une **projection perspective** (distorsion, angle de vue oblique). La transformation image → carte n'est pas une simple rotation/translation — c'est au minimum une **homographie** (transformation projective 2D → 2D), voire un modèle plus complexe si le terrain n'est pas plan.

### Dépendances architecturales

```
autoabsmap  ←  calib_gen  ←  pairing
```

Le module `pairing` consomme les `GeoSlot` de `autoabsmap` et les bboxes produites par le package `calib_gen`. Il ne produit aucun ID — il ne fait que lier des identifiants existants.

**Documentation calib :** [`calib_gen/docs/calib_generator.md`](../../calib_gen/docs/calib_generator.md)

---

## Approche 1 — Homographie semi-supervisée (ancres manuelles)

### Principe

L'opérateur apparie manuellement **4 à 6 paires** (bbox caméra ↔ GeoSlot). À partir de ces correspondances, on calcule une **matrice d'homographie** H qui projette les centres image vers les coordonnées carte. On projette ensuite tous les bboxes restants et on les matche aux GeoSlots par **proximité de centroïde**.

### Algorithme

```python
import cv2
import numpy as np

def compute_pairing_homography(
    anchor_pairs: list[tuple[tuple[float,float], tuple[float,float]]],
    camera_bboxes: list[dict],
    geo_slots: list[GeoSlot],
    max_distance_m: float = 3.0,
) -> list[tuple[str, str]]:
    """
    anchor_pairs: [(center_px, (lng, lat)), ...] — au moins 4
    Returns: [(bbox_slot_id, geoslot_id), ...]
    """
    src = np.float32([p[0] for p in anchor_pairs])
    dst = np.float32([p[1] for p in anchor_pairs])
    H, _ = cv2.findHomography(src, dst, cv2.RANSAC)

    paired = []
    for bbox in camera_bboxes:
        center_px = np.float32([[bbox["center_px"]]])
        projected = cv2.perspectiveTransform(center_px, H)[0][0]
        best = min(geo_slots, key=lambda s: haversine(projected, s.center))
        if haversine(projected, best.center) < max_distance_m:
            paired.append((bbox["slot_id"], best.slot_id))
    return paired
```

### Avantages

- Mathématiquement solide pour un sol plat (parking = plan)
- 4-6 clics suffisent, le reste est automatique
- `cv2.findHomography` est bien documenté et robuste avec RANSAC
- Le `match_slots` greedy de `benchmark.py` peut être réutilisé pour l'assignation

### Inconvénients

- Nécessite un minimum d'interaction manuelle
- Hypothèse de planéité : diverge si le parking a des niveaux ou du dénivelé
- Sensible si les ancres sont regroupées dans un coin (mauvais conditionnement de H)

### Effort estimé

Moyen. Le gros du travail est l'UX frontend (cliquer alternativement image / carte).

---

## Approche 2 — Matching par ordonnancement topologique (row-column)

### Principe

Les places de parking ont un **ordre spatial naturel** : elles sont organisées en rangées. Si on identifie les rangées dans les deux espaces (image et carte), on peut apparier par **position ordinale** dans chaque rangée.

### Algorithme

1. **Grouper en rangées** dans les deux espaces — DBSCAN sur la projection perpendiculaire à l'axe dominant (même logique que `pairing/pairing-rd/line_slot_detector.py`)
2. **Trier les rangées** par distance croissante à un point de référence (coin haut-gauche image / coin nord-ouest carte)
3. **Dans chaque rangée**, trier les slots par position le long de l'axe de la rangée
4. **Apparier par index** : rangée i, position j dans l'image → rangée i, position j dans la carte

### Avantages

- Zéro interaction manuelle (full auto)
- Robuste à la déformation perspective (l'ordre est préservé par la projection)
- Simple à implémenter

### Inconvénients

- **Fragile** si le nombre de slots diffère entre image et carte (détections manquantes)
- Suppose que les rangées sont clairement séparables dans les deux espaces
- Problème de correspondance rangée ↔ rangée si l'angle caméra est très différent de l'aérien
- Ne gère pas bien les parkings en épi non réguliers

### Effort estimé

Faible à moyen.

---

## Approche 3 — Graph matching (structure de voisinage)

### Principe

Construire un **graphe de voisinage** dans chaque espace (nœuds = slots, arêtes = voisins proches) avec des attributs relatifs (distances, angles entre voisins). Puis utiliser un algorithme de **graph matching** pour trouver l'isomorphisme.

### Algorithme

1. Pour chaque espace, construire un graphe de Delaunay ou k-NN
2. Calculer des **descripteurs relatifs** par nœud : nombre de voisins, distribution d'angles entre arêtes, ratios de distances
3. Résoudre le matching par **Spectral Graph Matching** ou **Hungarian algorithm** sur une matrice d'affinité basée sur la similarité des descripteurs

### Avantages

- Invariant aux transformations projectives (les relations de voisinage se conservent)
- Gère bien les parkings irréguliers
- Tolère quelques slots manquants (matching partiel)

### Inconvénients

- Plus complexe à implémenter
- Coût computationnel O(n³) pour Hungarian
- Peut être ambigu dans des parkings très réguliers (tous les nœuds se ressemblent)

### Effort estimé

Élevé.

---

## Approche 4 — ICP adapté (Iterative Closest Point)

### Principe

On donne une **initialisation grossière** (1-2 ancres ou rotation approximative), puis un algorithme ICP itère jusqu'à convergence.

### Algorithme

1. Projeter les centres caméra dans l'espace carte via la transformation courante
2. Apparier chaque point projeté au GeoSlot le plus proche (greedy)
3. Recalculer la meilleure transformation (homographie ou affine) à partir des paires
4. Répéter jusqu'à convergence

### Avantages

- Très peu d'initialisation nécessaire
- Converge bien si la distribution spatiale des slots est distinctive
- Algorithme classique, bien compris

### Inconvénients

- Peut converger vers un minimum local si l'initialisation est mauvaise
- L'ICP standard suppose une transformation rigide — adaptation nécessaire pour une homographie
- Sensible aux outliers (slots détectés dans un espace mais pas l'autre)

### Effort estimé

Moyen.

---

## Approche 5 — Hybride : ancres manuelles + propagation automatique (recommandée)

### Principe

Combinaison semi-automatisée et progressive. L'opérateur fournit un minimum de paires, le système propose le reste, l'opérateur valide.

### Workflow

1. **L'opérateur clique 2-3 paires** (bbox image ↔ slot carte)
2. **Avec 2 paires** → transformation **affine** (rotation + translation + scale) — première approximation
3. **Le système propose les paires restantes** par proximité après projection, avec un score de confiance
4. **L'opérateur valide/corrige** les propositions (UI accept/reject par lot)
5. **Avec ≥ 4 paires validées** → recalcul d'une **homographie** complète, re-proposition des non-appariés
6. **Itération** jusqu'à ce que tout soit apparié ou marqué "non apparié"

### Pourquoi c'est le meilleur compromis

- **Progressive** : aide dès 2 clics, s'améliore avec chaque validation
- **Robuste** : l'opérateur corrige les erreurs en temps réel, pas de divergence silencieuse
- **Compatible avec l'UX existante** : le frontend a déjà la dual-map et la sélection de slot — le pairing s'insère naturellement
- **Capitalise sur `match_slots`** de `benchmark.py` pour l'assignation greedy
- **Alignée avec l'architecture** : `autoabsmap ← calib_gen ← pairing`

### Interface frontend suggérée

```
┌──────────────────────────┬──────────────────────────┐
│   IMAGE CAMÉRA           │   CARTE (MAP)            │
│                          │                          │
│   [bbox highlighted]     │   [geoslot highlighted]  │
│   clic → ancre A1        │   clic → ancre A1        │
│                          │                          │
│   ── après 2+ ancres ──  │   ── après 2+ ancres ──  │
│   propositions auto      │   liens projetés         │
│   [✓] [✗] par paire      │   affichés sur la carte  │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

### Effort estimé

Moyen. Briques mathématiques éprouvées (affine → homographie → greedy). L'effort principal est côté frontend.

---

## Résumé comparatif

| Approche | Automatisation | Robustesse | Effort dev | Adapté au contexte |
|----------|---------------|------------|-----------|-------------------|
| 1. Homographie + ancres | Semi-auto (4-6 clics) | Bonne (sol plat) | Moyen | Oui |
| 2. Ordonnancement topologique | Full auto | Fragile | Faible | Parkings réguliers uniquement |
| 3. Graph matching | Full auto | Bonne | Élevé | Overkill pour la v1 |
| 4. ICP adapté | Semi-auto (1-2 clics) | Moyenne | Moyen | Risque de minimum local |
| **5. Hybride (recommandée)** | **Semi-auto progressif** | **Très bonne** | **Moyen** | **Excellent** |

## Recommandation

Partir sur l'**approche 5 (hybride)** pour la v1. Elle s'intègre naturellement dans l'UX dual-map existante, et le pipeline mathématique (affine → homographie → greedy matching) est composé de briques éprouvées.

L'approche 2 (topologique) peut servir de **heuristique de bootstrap** pour proposer les premières paires avant même que l'opérateur ne clique, mais elle ne doit pas être le seul signal.
