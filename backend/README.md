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