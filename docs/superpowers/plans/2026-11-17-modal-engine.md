# Moteur SongToSheet sur Modal — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire tourner le worker de transcription sur Modal (GPU L4, à la seconde), réveillé par le site, pour que SongToSheet ne dépende plus du PC de Tanguy.

**Architecture:** Le site Vercel appelle un endpoint Modal `wake` quand un job passe en file ; `wake` lance `process_queue` (GPU) qui vide la file avec le code existant de `track_worker.py` puis s'arrête. Une tâche planifiée CPU (`watchdog`) relance le moteur si un réveil s'est perdu, via une nouvelle action worker `peek`. Un workflow GitHub déploie l'app Modal à chaque push sur `main`.

**Tech Stack:** Python 3.11, Modal SDK, FastAPI (endpoint Modal), Node 22 (fonctions Vercel, `node:test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-17-modal-engine-design.md`

## Global Constraints
- GPU `L4`, `cpu=8`, `memory=16384`, `timeout=600`, `scaledown_window=15`, `max_containers=2` pour `process_queue`.
- Watchdog : sans GPU, toutes les 2 minutes (`modal.Period(minutes=2)`).
- Nom de l'app Modal : `songtosheet-engine` ; secret Modal : `songtosheet-worker` (clés `TRACK_WORKER_TOKEN`, `ENGINE_WAKE_SECRET`, `SITE_URL`).
- Variables Vercel : `ENGINE_WAKE_URL`, `ENGINE_WAKE_SECRET`. Secrets GitHub : `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`.
- Appel `wake` depuis le site : 2 s max, jamais bloquant ni fatal pour la requête de l'utilisateur.
- Aucun secret dans le dépôt ; poids des modèles téléchargés à la construction de l'image (YourMT3+ vérifié par `CHECKPOINT_SHA256`).
- Les commits/versions épinglés du `backend/README.md` (mt3-infer `d8cbd287…`, Tsumugi `eba1c7d0…`, GuitarArranger `cd54d5b2…`, REMI-z `832b96a0…`) sont repris tels quels.

## Review Focus
1. `ENGINE_WAKE_URL` absente (site actuel, PC encore utilisé) → le site fonctionne comme aujourd'hui, aucun appel. (Task 1)
2. Endpoint Modal lent ou en panne → la création du job répond quand même en < 2,5 s. (Task 1)
3. Appel à `wake` sans le bon secret → 403, aucun GPU lancé. (Task 3)
4. Un job plante au milieu → les jobs suivants de la file sont quand même traités. (Task 2)
5. Deux réveils simultanés → aucun job traité deux fois (le `claim` atomique existant), la boucle s'arrête quand la file est vide. (Task 2)

---

### Task 1: Site — réveil du moteur et action `peek`

**Files:**
- Create: `lib/engine-wake.js`
- Modify: `api/track.js` (constante `WORKER_ACTIONS`, fonction `worker`, `begin` après `insertOne` quand `link`, `upload` après passage en `queued`)
- Test: `tests/engine-wake.test.js` (Node `node:test`, exécuté par `node --test tests/`)

**Interfaces:**
- Produces: `wakeEngine(): Promise<void>` (jamais rejetée) ; action worker `peek` → `200 {queued: boolean}`.

- [ ] **Step 1: Tests**
  - `test('no URL configured: no request')` : sans `ENGINE_WAKE_URL`, `fetch` mocké n'est jamais appelé.
  - `test('posts the shared secret')` : `fetch` appelé une fois avec `method:'POST'`, en-tête `authorization: 'Bearer ' + ENGINE_WAKE_SECRET`.
  - `test('slow or failing engine does not throw or block')` : `fetch` qui ne répond jamais → `wakeEngine()` résolue en < 2500 ms ; `fetch` qui rejette → résolue sans erreur.
  - `test('peek reports a queued job')` : avec le mock Mongo de `/tmp/sim.js` (findOne renvoie un job `queued`), `POST {action:'peek'}` avec le bon jeton worker → `200 {queued:true}` ; sans jeton → `403`.
- [ ] **Step 2:** `node --test tests/` → FAIL (module absent).
- [ ] **Step 3:** `lib/engine-wake.js` : `fetch(ENGINE_WAKE_URL,{method:'POST',headers,signal:AbortSignal.timeout(2000)})`, `catch` silencieux. Dans `api/track.js` : ajouter `'peek'` à `WORKER_ACTIONS` ; `peek` = `findOne({active:true,status:'queued',expires_at:{$gt:now}},{projection:{_id:1}})` ; `await wakeEngine()` après la mise en file (dans `begin` si `link`, dans `upload` action `queue` si `modifiedCount`).
- [ ] **Step 4:** `node --test tests/` → PASS ; `node --check api/track.js`.
- [ ] **Step 5:** commit `feat(site): wake the cloud engine when a job is queued`.

### Task 2: Worker — mode « vider la file puis s'arrêter »

**Files:**
- Modify: `backend/track_worker.py` (extraire `claim_payload(...)` et la boucle de `main`)
- Test: `backend/tests/test_track_worker_drain.py`

**Interfaces:**
- Produces: `claim_payload(engines: Engines, guided_guitar_only=False, piano_only=False) -> dict` ; `drain(call, engines: Engines, cache: Path, *, max_jobs=50) -> int` (nombre de jobs traités) ; `Engines` = dataclass `guitar, solo, piano, solo_piano` ; `load_engines() -> Engines` (lit l'environnement comme aujourd'hui) ; `make_call(url: str, token: str) -> (callable, requests.Session)`.
- Consumes: `process_job` existant.

- [ ] **Step 1: Tests** (avec `process_job` patché)
  - `test_drain_processes_until_queue_empty` : `call('claim')` renvoie 2 jobs puis `{'job': None}` → `drain` renvoie 2, `process_job` appelé 2 fois.
  - `test_drain_continues_after_failed_job` : le 1er `process_job` lève `ValueError` → le 2e job est traité, `drain` renvoie 2.
  - `test_drain_stops_at_max_jobs` : `claim` renvoie toujours un job → s'arrête à `max_jobs=3`.
  - `test_claim_payload_matches_engines` : `piano=None` → `piano_compare` False et `piano_judge_version` None ; avec un piano → `3`.
- [ ] **Step 2:** `python -m pytest backend/tests/test_track_worker_drain.py -q` → FAIL.
- [ ] **Step 3:** implémenter ; `main()` réutilise `load_engines`, `claim_payload`, `make_call` (comportement CLI inchangé). Une exception `requests.RequestException` dans `drain` remonte (comme `--once`).
- [ ] **Step 4:** `python -m pytest backend/tests -q` → tout PASS.
- [ ] **Step 5:** commit `refactor(worker): drain mode for cloud runs`.

### Task 3: App Modal `songtosheet-engine`

**Files:**
- Create: `backend/engine_cloud.py` (logique pure, sans import de `modal`), `backend/modal_app.py`
- Test: `backend/tests/test_engine_cloud.py`

**Interfaces:**
- Produces (`engine_cloud.py`) : `wake_allowed(authorization: str | None, secret: str) -> bool` (comparaison `hmac.compare_digest`, refuse secret vide) ; `queue_has_job(call) -> bool` (action `peek`).
- Produces (`modal_app.py`) : `app = modal.App("songtosheet-engine")` ; `process_queue()` (GPU) ; `wake(request)` (`@modal.fastapi_endpoint(method="POST")`, répond `{"started": true}` après `process_queue.spawn()`, 403 sinon) ; `watchdog()` (`schedule=modal.Period(minutes=2)`) ; `benchmark(url: str)` (local entrypoint `modal run` : télécharge un audio YouTube, exécute `generate` piano sur 30 s puis sur 180 s, imprime le temps par étape).
- Consumes: `drain`, `load_engines`, `make_call` (Task 2).

- [ ] **Step 1: Tests** : `wake_allowed('Bearer s3cret','s3cret')` True ; mauvais secret, en-tête absent, secret vide → False ; `queue_has_job` avec `call` mocké renvoyant `{'queued': True}` / `{'queued': False}`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** `engine_cloud.py`, puis `modal_app.py` : image `debian_slim(python_version="3.11")` + apt `ffmpeg chromium git curl` + Node 22 ; venv principal (`requirements*.txt`) ; venv `/opt/yourmt3` (torch, `transformers==4.43.4`, mt3-infer épinglé, `transkun==2.0.1`, `moduleconf`) ; clones épinglés Tsumugi/GuitarArranger/REMI-z ; téléchargement des poids dans l'image (`run_commands`), contrôle SHA-256 YourMT3+ ; variables `TRACK_*` de l'image pointant vers ces chemins ; `TRACK_PDF_BROWSER=/usr/bin/chromium`. Modèles chargés une fois par conteneur (`load_engines()` + `warm()` au démarrage de `process_queue`).
- [ ] **Step 4:** pytest → PASS ; `python -c "import ast; ast.parse(open('backend/modal_app.py').read())"`.
- [ ] **Step 5:** commit `feat(engine): Modal app with wake endpoint and watchdog`.

### Task 4: Déploiement automatique et documentation

**Files:**
- Create: `.github/workflows/deploy-engine.yml`
- Modify: `backend/README.md` (section « Hébergement Modal »), `README.md` (variables Vercel)

- [ ] **Step 1:** workflow : `on: push` (`branches:[main]`, `paths:['backend/**']`) + `workflow_dispatch` avec entrée `benchmark_url` ; job : `pip install modal` ; `modal deploy backend/modal_app.py` ; si `benchmark_url` → `modal run backend/modal_app.py::benchmark --url "$BENCHMARK_URL"`. Env : `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` depuis les secrets GitHub.
- [ ] **Step 2:** `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-engine.yml'))"` → aucune erreur.
- [ ] **Step 3:** README : étapes de Tanguy (compte, token → secrets GitHub, secret Modal `songtosheet-worker`, variables Vercel, où lire `ENGINE_WAKE_URL` après le 1er déploiement), coût attendu, retour au PC possible.
- [ ] **Step 4:** commit `ci: deploy the engine to Modal from main`.

### Task 5: Mesure réelle (après création des secrets par Tanguy)

- [ ] **Step 1:** lancer le workflow `deploy-engine` en `workflow_dispatch` avec un lien YouTube de 3 min (`gh api repos/Guyguy25/songtosheet/actions/workflows/deploy-engine.yml/dispatches`).
- [ ] **Step 2:** lire les logs (`gh api .../actions/runs/{id}/logs`) : temps aperçu 30 s ≤ 30 s, morceau 3 min ≤ 60 s attendus ; noter le coût (secondes GPU × 0,000222 $ + CPU/mémoire).
- [ ] **Step 3:** si > 60 s : passer `gpu="A10"` puis `"L40S"`, relancer ; rapporter les chiffres mesurés à Tanguy.
