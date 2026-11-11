# SongToSheet.ai — V1 fonctionnelle (prototype local)

SongToSheet est un SaaS B2C francophone de **transcription de mélodie audio vers partition PDF, MIDI et MusicXML**, avec landing page responsive, espace utilisateur, bibliothèque et crédits prépayés.

> **Limites explicites** — Il s'agit d'une V1 technique et non d'un service prêt pour une commercialisation publique. Le moteur extrait une **mélodie principale approximative** (pas un arrangement polyphonique ni des tablatures complètes). Les liens YouTube / Spotify sont reconnus comme références, mais l'audio doit être importé par l'utilisateur avec les droits nécessaires. Les paiements nécessitent tes clés Stripe. Le stockage local SQLite/fichiers et les tâches en processus doivent être remplacés avant le passage à l'échelle.

## Démarrage rapide

Prérequis : Python 3.11/3.12, `ffmpeg` et `ffprobe` dans le `PATH`.

```bash
cd songtosheet-v1
python -m venv .venv
source .venv/bin/activate       # sous Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
# Remplacer SESSION_SECRET par une valeur aléatoire et longue dans .env
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Ouvre **http://localhost:8000**.

La page d'inscription crée un compte avec **0 crédit** : aucun essai gratuit. Les crédits sont vendus en packs, puis consommés à raison de 1 crédit par minute commencée **si et seulement si la transcription aboutit**.

### Tester la génération sans payer (développement uniquement)

Crée un compte de test via l'interface, puis dans un autre terminal :

```bash
DEV_MODE=1 python scripts/dev_credits.py test@example.com 10
```

Recharge le dashboard, sélectionne « Nouvelle partition » et importe un fichier `.wav` / `.mp3`. L'audio original est effacé du serveur après traitement. La bibliothèque conserve les notes et exports générés.

Le fichier `tests/melody.wav` est un enregistrement synthétique original utilisé pour les tests automatisés, et permet de valider le moteur.

## Prototype de transcription par instrument

Le moteur `transcribe_track.py` utilise Demucs pour estimer une piste de voix, basse, guitare ou piano, puis Basic Pitch pour en détecter les notes. Demucs peut mélanger certains instruments, en particulier sur la piste de piano. La précision reste à mesurer sur un corpus autorisé.

### Tester dans SongToSheet

Depuis la racine du dépôt, lance `npm ci` pour installer les bibliothèques du lecteur de partition et du piano roll.

Dans le dossier `backend`, utilise Python 3.11, FFmpeg et un navigateur Chromium (Chrome ou Edge sous Windows). Sous PowerShell :

```powershell
python -m pip install -r requirements.txt -r requirements-transcription.txt
$env:DEV_MODE = '1'
$env:TRACK_TRANSCRIPTION_TEST = '1'
$env:DATA_DIR = './data/track-test'
python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Ouvre http://127.0.0.1:8765/inscription, crée un compte local et sélectionne **Nouvelle partition**. Choisis l’instrument que tu veux jouer, le format puis indique si le morceau contient une voix. À la dernière étape, charge la mélodie de test ou importe un fichier et confirme les droits. Le PDF suit le format choisi. Si aucune tablature jouable ne peut être générée, le moteur fournit le PDF de la partition. Les exports restent dans ta bibliothèque locale. Le mode de test fonctionne sans crédits ni paiement et traite un fichier à la fois.

### Tester en ligne de commande

Dans un environnement Python 3.11 séparé, avec FFmpeg et FFprobe disponibles :

```sh
python -m pip install -r requirements-transcription.txt
python transcribe_track.py tests/melody.wav guitare ./exports-prives --isolated --authorized
```

Pour traiter un mix, retire `--isolated` et choisis la piste à extraire. Demucs télécharge ses poids au premier usage. Utilise `--bpm` si tu connais le tempo. Le MIDI conserve les timings estimés et le MusicXML les quantifie à un tempo et une mesure fixes. En accordage standard, la tablature place les notes simultanées sur des cordes différentes quand un doigté est disponible. Elle affiche les attaques sur une grille de triples croches et indique les notes à laisser résonner. Le MIDI de tablature conserve les attaques et durées des notes placées.

Le moteur écrit `score.mid`, `score.musicxml`, `notes.json` et, lorsqu’un doigté est disponible, `tab.musicxml` et `tab.mid`. Il efface les fichiers audio intermédiaires et réutilise un export complet si les octets du fichier et les paramètres correspondent. Réserve un dossier d’exports privé à chaque utilisateur si tu intègres le moteur à un service.

Le prototype exige une confirmation explicite des droits via `--authorized`. Il lit un fichier local. Les liens YouTube et Spotify restent des références pour identifier le morceau. Un catalogue partagé devra vérifier la licence de chaque partition, conserver sa provenance et respecter les conditions d’accès du fournisseur. La confirmation de l’utilisateur ne vaut pas autorisation de republier le résultat.

### Moteur pour la bêta administrateur

Le site public utilise les comptes MongoDB existants. La transcription réelle est réservée aux comptes portant `role: "admin"` dans la base. Le site stocke les fragments audio jusqu’à la fin du traitement, avec une expiration automatique après deux heures. La bibliothèque conserve les exports et les affiche uniquement au propriétaire.

Installe les dépendances du moteur et Chromium sur la machine de calcul. Si le navigateur est installé dans un dossier personnalisé, configure le chemin de l’exécutable avec `TRACK_PDF_BROWSER`. Configure le jeton hexadécimal de 32 octets dans `TRACK_WORKER_TOKEN` sur cette machine et uniquement son empreinte SHA-256 hexadécimale dans `TRACK_WORKER_DIGEST` sur Vercel. Lance le moteur depuis `backend` :

```powershell
python .\track_worker.py https://songtosheet.vercel.app .\data\production-track-cache
```

Les demandes passent par le site public. La machine qui exécute le moteur doit rester allumée et connectée pour les traiter. Les fichiers audio intermédiaires sont supprimés en fin de traitement. Le cache local contient les exports.

### Mesurer la précision d’un relevé

Avec l’environnement de transcription, utilise un MIDI de référence corrigé et aligné sur le même enregistrement :

```powershell
python .\evaluate_transcription.py .\score.mid --reference .\reference.mid --guitare
```

L’évaluation mesure la précision, le rappel et le F1 des notes. Elle compare la hauteur et l’attaque à 50 ms près, puis évalue aussi la fin de note dans une seconde mesure. Sans référence, le script liste les notes hors tessiture en accordage standard sur une guitare à 24 cases.

## Bêta guitare sur le worker de transcription

Le worker utilise **Tsumugi Guitar v1.5** pour le relevé guitare et **GuitarArranger** pour la version Solo. Demucs sépare les pistes du mix. Pour l’arrangement, le worker prépare une ligne mélodique à partir de la voix et du riff, puis réutilise l’harmonie du mix. Le relevé est publié dès qu’il est prêt. Le Solo arrive ensuite dans le même résultat.

Prépare un environnement séparé pour Tsumugi avec les dépendances officielles. Ce modèle et les poids guitare sont publiés sous MIT. Utilise l’inférence de base sans l’option SheetSage2.

```bash
git clone https://github.com/anime-song/tsumugi.git /opt/tsumugi
git -C /opt/tsumugi checkout eba1c7d05e4d6a53cc4e8916d742d9623a3fdc38
(cd /opt/tsumugi && uv sync --locked --no-dev)
curl -fL https://huggingface.co/anime-song/instrument_agnostic_amt/resolve/main/best_model_guitar_v1_5.pth \
  -o /opt/tsumugi/best_model_guitar_v1_5.pth
export TRACK_TSUMUGI_ROOT=/opt/tsumugi
export TRACK_TSUMUGI_CHECKPOINT=/opt/tsumugi/best_model_guitar_v1_5.pth
export TRACK_TSUMUGI_PYTHON=/opt/tsumugi/.venv/bin/python
export TRACK_TSUMUGI_DEVICE=auto
```

Ajoute GuitarArranger et REMI-z à la machine de calcul. Les commits ci-dessous correspondent à la version testée.

```bash
git clone https://github.com/Sonata165/GuitarArranger.git /opt/guitararranger
git -C /opt/guitararranger checkout cd54d5b268d67404853b5aeb0b40eb7f6c0a27a4
git clone https://github.com/Sonata165/REMI-z.git /opt/remi-z
git -C /opt/remi-z checkout 832b96a0f990cdc3b67998836f3c067290632f6b
python -m pip install miditoolkit==1.0.1 'PyYAML>=6.0.2'
export TRACK_GUITARARRANGER_ROOT=/opt/guitararranger
export TRACK_REMI_ROOT=/opt/remi-z
```

Redémarre le worker avec les deux moteurs configurés. Les nouveaux aperçus requièrent ce worker et limitent l’inférence à 30 secondes. Le serveur renvoie les fichiers de cet extrait. La suite floutée est dessinée par le lecteur à partir d’une notation illustrative. Piano et basse utilisent Basic Pitch. Les licences MIT sont conservées dans les dépôts amont.

## Paiement Stripe

Les packs de crédits sont définis côté serveur dans `PACKS` dans `app.py` :

| Pack | Prix indicatif | Crédits |
|---|---:|---:|
| Découverte | 9 € | 10 |
| Musicien | 19 € | 30 |
| Studio | 39 € | 80 |

Dans `.env` :

```text
PUBLIC_BASE_URL=https://ton-domaine-configure.com
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
DEV_MODE=0
```

Dans le dashboard Stripe, crée un endpoint `https://ton-domaine-configure.com/api/stripe/webhook` et abonne-le à `checkout.session.completed`.

Le serveur valide la signature HMAC et le montant, crédite une seule fois chaque **session Checkout** et ne considère pas le simple retour sur la page de succès comme preuve de paiement. Si les clés sont absentes, l'API refuse tout checkout (503) : rien n'est débité.

**Ne jamais commettre `.env` ni partager les secrets.** Les prix et le contenu des offres doivent être validés commercialement et juridiquement avant activation réelle.

## Parcours produit

1. Landing page : hero avec lien ou audio, exemples de partitions, trois étapes, bénéfices, pricing, FAQ.
2. Lien YouTube / Spotify : validation du format et conservation de la référence, puis demande de fichier audio autorisé.
3. Inscription / connexion email et mot de passe (PBKDF2). Cookie HttpOnly signé et SameSite.
4. Dashboard : solde de crédits, historique, nouvelle transcription, bibliothèque.
5. Upload audio : 25 Mo et 6 min maximum, formats MP3, WAV, M4A, FLAC, OGG, AAC.
6. Vérification et réservation des crédits ; génération en tâche asynchrone.
7. Extraction de mélodie, PDF, MIDI, MusicXML, aperçu SVG, téléchargement authentifié.
8. Débit des crédits après succès. Aucun débit si l'analyse échoue.
9. Achat Stripe par pack, webhook signé et idempotent.

## API

| Endpoint | Fonction |
|---|---|
| `GET /api/health` | Vérification de l'app |
| `GET /api/packs` | Tarifs disponibles |
| `POST /api/auth/signup`, `login`, `logout` | Compte |
| `GET /api/auth/me` | Session / crédits |
| `POST /api/links/inspect` | Inspection de lien sans téléchargement |
| `POST /api/jobs` | Upload et création de job |
| `GET /api/jobs`, `/api/jobs/{id}` | Bibliothèque et état |
| `GET /api/jobs/{id}/download/{pdf\|mid\|musicxml}` | Exports privés |
| `POST /api/checkout` | Création Checkout Stripe |
| `POST /api/stripe/webhook` | Crédit après paiement validé |

## Tests

```bash
python -m pytest tests/test_app.py -q
node --check web/app.js
```

Les tests vérifient notamment : aucun crédit gratuit à l'inscription, connexion, validation des liens, refus d'upload sans crédits, génération et trois exports, signature Stripe et idempotence d'un paiement.

## Avant de commercialiser

- **Transcription et qualité musicale :** remplacer le relevé monophonique expérimental par un moteur audio multi-instrument adapté, mesurer la précision, ajouter tablatures et correction utilisateur.
- **Liens :** obtenir une méthode d'accès audio légalement autorisée par chaque fournisseur et les ayants droit ; sinon conserver l'import de fichiers. Ne pas ajouter de contournement des restrictions YouTube/Spotify.
- **Infra :** PostgreSQL managé, stockage objet privé (ex. S3), queue Redis + workers indépendants, quotas/rate limiting partagés, reprise des jobs après redémarrage, surveillance et backups.
- **Paiement :** tester de bout en bout en environnement Stripe test, vérifier TVA et facturation, remboursements, consentements et litiges.
- **Sécurité :** email verification, réinitialisation mot de passe, anti-abus, scans dépendances, revues d'upload, RGPD (rétention/suppression), journaux, authentification OAuth en option.
- **Légal :** mentions légales, CGV, politique de confidentialité, licences de contenu, droits voisins/copyright, marque et domaine.
- **Design :** tests utilisateurs réels, analytics conversion du lien à l'achat, tests responsive sur de vrais appareils.

## Arborescence

```text
app.py               API FastAPI / auth / jobs / Stripe / crédits
transcriber.py       Extraction de mélodie + PDF/MIDI/MusicXML
web/index.html       Landing, espace client et connexion
web/styles.css       Design responsive
web/app.js           Interactions frontend et partition SVG
web/favicon.svg      Identité visuelle
scripts/dev_credits.py   Crédits réservés au développement local
requirements.txt     Dépendances Python
Dockerfile           Container de déploiement pour un serveur persistant
.env.example         Paramètres requis
/tests               Tests d'intégration et fichier audio original
```
