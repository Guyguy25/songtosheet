# Moteur SongToSheet hébergé sur Modal — design

Date : 17/11/2026 · Statut : en attente de validation de Tanguy

## Intention

Aujourd'hui, `backend/track_worker.py` tourne sur le PC de Tanguy. S'il est éteint, chaque génération
échoue au bout de 5 minutes. On veut que le moteur tourne dans le cloud, sans machine à garder allumée,
avec une génération de 30 s à 1 min par morceau et un coût proche de 0 € au lancement
(au plus ~2 centimes par morceau au-delà des crédits offerts).

## Objectifs
- Le site (Vercel) fonctionne sans le PC de Tanguy.
- 30 s à 1 min pour un morceau de 3 min, moins pour l'aperçu de 30 s.
- 0 € tant que l'usage reste dans les 30 $ de crédits mensuels Modal (≈ 1 500 morceaux entiers estimés).
- Déploiement sans commande à lancer chez Tanguy : chaque push sur `main` redéploie le moteur.

## Non-objectifs
- Changer la qualité des moteurs (fait dans la PR #15) ou le parcours payant.
- Migrer le site hors de Vercel.

## Anti-objectifs (échec même si « ça marche »)
- Une machine à carte graphique qui reste allumée à vide et coûte en continu.
- Des secrets écrits dans le dépôt, ou demandés à Tanguy dans la conversation.
- Une génération qui reste bloquée sans message parce que le réveil du moteur a été perdu.

## Contraintes
- Le protocole worker ↔ site existe déjà (`POST /api/track`, actions `claim/read/progress/preview/finish`,
  jeton `TRACK_WORKER_TOKEN` dont Vercel ne connaît que l'empreinte `TRACK_WORKER_DIGEST`).
- Délais du site : 5 min max en file d'attente, 5 min max de traitement.
- Moteurs à embarquer : YourMT3+ (env Python séparé, checkpoint vérifié par SHA-256), Transkun, Demucs,
  Basic Pitch, beat_this (piano) ; Tsumugi (env `uv` séparé, commit épinglé) et GuitarArranger + REMI-z
  (guitare) ; FFmpeg, Node (yt-dlp), Chromium (PDF).
- YouTube peut bloquer les téléchargements depuis des IP de datacenter : le message d'erreur existant
  propose déjà l'import de fichier.

## Approches envisagées
| Approche | Coût par morceau (estimé) | Au lancement | Verdict |
|---|---|---|---|
| **Modal, L4 à la seconde** | ~1,5–2 c | 0 € (30 $ offerts/mois) | **Retenue** |
| RunPod Serverless 24 Go | ~1 c | payant dès le 1er morceau | Plus intéressant au-delà de ~6 000 morceaux/mois |
| Serveur GPU au mois (Hetzner GEX44) | fixe ~232 €/mois | 232 € | Au-delà de ~15 000 morceaux/mois |
| Vercel / Cloudflare / VPS sans GPU | — | — | Écartés : pas de carte graphique, impossible de tenir 30 s–1 min |

Tanguy a choisi d'aller au moins cher sans engagement ; Modal retenu. L'image est un conteneur standard
pour pouvoir passer sur RunPod plus tard sans réécriture.

## Design

### 1. Application Modal `songtosheet-engine` (`backend/modal_app.py`)
- **Image** construite une fois : Debian + FFmpeg + Node 22 + Chromium ; venv principal
  (`requirements.txt` + `requirements-transcription.txt`) ; venv YourMT3+ (PyTorch, `mt3-infer` épinglé,
  `transkun==2.0.1`, `moduleconf`) ; dépôts Tsumugi, GuitarArranger, REMI-z aux commits du README.
  Les poids (YourMT3+ avec contrôle SHA-256, Tsumugi, Demucs `htdemucs`/`htdemucs_6s`, beat_this) sont
  téléchargés **à la construction de l'image**, jamais au démarrage d'un conteneur.
- **Fonction `process_queue`** : GPU L4, 8 cœurs, 16 Go, `timeout` 10 min, `scaledown_window` 15 s,
  `max_containers` 2 (plafond de coût et de concurrence). Elle charge les modèles une fois, puis appelle
  `claim` en boucle et traite les jobs (code existant de `process_job`) jusqu'à ce que la file soit vide,
  et s'arrête.
- **Endpoint `wake`** (`@modal.fastapi_endpoint`, sans GPU) : vérifie un secret partagé, puis lance
  `process_queue` en arrière-plan et répond tout de suite.
- **Filet de sécurité** : une fonction planifiée sans GPU toutes les 2 minutes regarde s'il reste des jobs
  en file (action `peek`, nouvelle, lecture seule) et réveille `process_queue` si besoin. Coût négligeable
  (CPU seul, quelques secondes).

### 2. Site (Vercel)
- Après qu'un job passe en `queued` (`begin` pour un lien, `queue` pour un fichier), `api/track.js`
  appelle l'endpoint `wake` sans attendre la réponse (2 s max, erreurs ignorées : le filet de sécurité
  prend le relais).
- Nouvelle action worker `peek` (authentifiée comme les autres) : renvoie seulement s'il existe un job
  en file.
- Variables à ajouter **par Tanguy** dans Vercel : `ENGINE_WAKE_URL`, `ENGINE_WAKE_SECRET`.

### 3. Secrets côté Modal (créés par Tanguy)
- Secret `songtosheet-worker` : `TRACK_WORKER_TOKEN` (même valeur qu'aujourd'hui), `ENGINE_WAKE_SECRET`
  (même valeur que dans Vercel), `SITE_URL` (`https://songtosheet.vercel.app`).

### 4. Déploiement automatique
- `.github/workflows/deploy-engine.yml` : à chaque push sur `main` qui touche `backend/`, lance
  `modal deploy backend/modal_app.py`. Secrets GitHub à ajouter par Tanguy : `MODAL_TOKEN_ID`,
  `MODAL_TOKEN_SECRET`.

### 5. Le PC reste possible
- `track_worker.py` garde son mode actuel : si Tanguy le relance chez lui, les deux coexistent (le site
  distribue les jobs avec `claim`).

### 6. Mesure avant de tout brancher (premier pas)
- Test jetable : un morceau de 3 min et un aperçu de 30 s passés dans `process_queue`, on note le temps
  par étape et le coût réel. Si on dépasse 1 min, leviers dans l'ordre : passer à une A10/L40S,
  limiter le juge à un extrait, réduire les versions comparées.

## Laissé au constructeur
- Organisation exacte du Dockerfile/Image Modal et des venvs.
- Format de la réponse `peek`.
- Journalisation des temps par étape (utile pour la mesure).

## Décisions prises par Claude (à vérifier par Tanguy)
- L4 (et non A10) pour commencer : la moins chère qui a assez de mémoire graphique (24 Go).
- 2 conteneurs maximum en parallèle : protège la facture, au prix d'une attente si 3 personnes
  génèrent en même temps.
- Arrêt 15 s après le dernier job : le meilleur compromis coût / réveils pour un trafic faible.
- Déploiement par GitHub Actions plutôt qu'une commande à lancer chez toi.
