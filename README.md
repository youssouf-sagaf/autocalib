# Autocalib3

Détection, calib et mapping des places de parking (voir [BusinessOverview.md](BusinessOverview.md) et [TechnicalPipeline.md](TechnicalPipeline.md)).

## Lancement (lecture directe)

Tout est lu **directement** : static_data et slots depuis Firestore, image depuis S3.

```bash
pip install -r requirements.txt

export FIREBASE_CREDENTIALS="../cv-backend/cv-database-dev-bf0ba9d663fd.json"
export FIRESTORE_PROD_CREDENTIALS="./database-cocoparks-firebase-adminsdk-e5647-350e2d1a78.json"
export AWS_CREDENTIALS=../moumed-cv-key.pem   # avec .pem : utilise la chaîne par défaut (env AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ou ~/.aws/credentials)

python run.py --device device_00000000d6a21d5e
python run.py --device device_00000000d6a21d5e --out result.json --visualize-web
```

**Options :**
- `--device` : identifiant du device
- `--strategy` : `angle`, `distance`, `delaunay`, `row_grid` (défaut: row_grid)
- `--out` : fichier de sortie (ex. result.json)
- `--visualize` : génère pairing.png
- `--visualize-web` : génère page HTML (image + carte côte à côte)

## Structure

- **run.py** : point d’entrée
- **pipeline/** : data (Firestore), centers, run, visualize, image_fetch (S3)
- **pairing.py**, **pipeline_*.py** : stratégies de pairing

## Dépendances

numpy, scipy, firebase-admin, matplotlib, opencv-python-headless, boto3
