# Mode Apprentissage — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** ajouter un jeu « Apprendre ce son ». Le morceau généré est découpé en niveaux (Écoute → Entraîne → Défi), validés au micro, avec étoiles, XP, combo, série et boss. La progression est enregistrée dans le compte.

**Architecture :** tout le jeu tourne dans le navigateur, en JS vanilla sous `backend/web/` :
- `learn-core.js` : règles pures (découpage, jugement, étoiles, XP), partagées avec le serveur ;
- `learn-audio.js` : micro et détection des notes ;
- `learn-mode.js` : vue et boucle de jeu.

La progression passe par `/api/learn`, réécrit vers la fonction existante `api/jobs.js`, ce qui évite une 13ᵉ fonction Vercel. La logique serveur vit dans `lib/learn.js`.

**Tech Stack :** JS vanilla (UMD navigateur + CommonJS), Web Audio API, canvas 2D, MongoDB, `node --test`.

**Spec :** `docs/superpowers/specs/2026-11-22-mode-apprentissage-design.md`

## Global Constraints

- Aucune API payante, aucune dépendance npm nouvelle, aucun appel au moteur Modal.
- Aucune nouvelle fonction dans `api/` (12 = limite Hobby). Ajouter `{"source":"/api/learn","destination":"/api/jobs?route=learn"}` dans `vercel.json`.
- L'écran partition reste identique, hormis le bouton `🎮 Apprendre` dans `.score-bar`.
- Le jeu n'utilise que les exports déjà servis par `/api/track?id=…&download=…` (MIDI 30 s pour le freemium).
- Route : `/app/<id>/apprendre`.
- Seuils : Parfait ±80 ms, Bien ±160 ms ; combo ×2/×3/×4 à 10/20/40 ; étoiles 1★ ≥ 60 %, 2★ ≥ 80 %, 3★ ≥ 95 % à 1× seulement (2★ au plus sous 1×) ; vitesses 0,6 / 0,8 / 1 ; Écoute à 0,75×.
- Niveau = 2 mesures (1 si < 4 s ; 2 → 1 mesure supplémentaire ou découpe si > 10 s) ; section = 4 niveaux + 1 boss.
- Détection : note juste à ±50 cents, octave tolérée ; accord validé si ≥ 60 % des classes de note attendues sont présentes.
- Micro : `echoCancellation:false, noiseSuppression:false, autoGainControl:false`. Son guide coupé par défaut en Entraîne et en Défi.
- Sans micro : le niveau est validé par une coche, sans étoiles (`stars:0, checked:true`), et débloque le suivant.
- **XP (décision d'implémentation)** : le score affiché en jeu applique le combo. L'XP enregistrée est recalculée par le serveur : `round(notes × accuracy × 10 × speed)` (notes ≤ 300), +100 pour un boss réussi (≥ 1★).
- Tous les textes en français dans le code, la traduction anglaise dans `assets/i18n-en.js`.
- DA : vue jeu sombre `#090712` → `#130b2d`, accent `#7549eb`, réussite `#2ac58b`, police Inter, cartes blanches `border-radius:20px`. Respecter `prefers-reduced-motion`.

## Review Focus

1. **Morceau avec une longue intro silencieuse ou des trous** : aucun niveau vide, et chaque niveau commence sur sa première note (test dans la Tâche 1).
2. **Aperçu freemium de 30 s coupé au milieu d'une mesure** : le dernier niveau jouable s'arrête à `previewEnd`, et le serveur refuse un niveau au-delà (tests dans les Tâches 1 et 2).
3. **Accord détecté avec une seule corde qui sonne** : il ne compte pas (en dessous de 60 %), mais rien ne casse ; une note seule détectée à l'octave compte (test dans la Tâche 3).
4. **Client qui envoie `accuracy: 5` ou `speed: 3`** : valeurs bornées, étoiles recalculées par le serveur (test dans la Tâche 2).
5. **Série de jours qui change de jour à minuit, ou à 2 jours d'écart** : +1 le lendemain, remise à 1 après un trou, inchangée le même jour (test dans la Tâche 2).

---

### Tâche 1 : Règles pures du jeu (`learn-core.js`)

**Files :**
- Create : `backend/web/learn-core.js` (UMD : `window.TablurioLearnCore` + `module.exports`)
- Test : `tests/learn-core.test.js`

**Interfaces :**
- Produces :
  - `buildLevels(notes, measureStarts, {previewEnd=Infinity}={}) -> Level[]` où `notes = [{time, midi, duration, string?, fret?}]`, `measureStarts = number[]` (secondes, croissantes, éventuellement vide), et `Level = {index, section, start, end, notes, boss:false}`. Les boss sont insérés après chaque groupe de 4 : `{index, section, start, end, notes, boss:true}` (start/end = ceux de la section).
  - `groupAttacks(notes, tolerance=0.06) -> Attack[]`, `Attack = {time, midis:number[], notes}`.
  - `judge(delta:number) -> 'perfect'|'good'|'miss'`.
  - `multiplier(combo:number) -> 1|2|3|4`.
  - `starsFor(accuracy:number, speed:number) -> 0|1|2|3`.
  - `xpFor({notes, accuracy, speed, boss}) -> number`.
  - `SPEEDS = [0.6, 0.8, 1]`, `LISTEN_SPEED = 0.75`.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
test('2 mesures par niveau, 4 niveaux + boss par section',()=>{
  const measures=[0,2,4,6,8,10,12,14,16,18];          // mesures de 2 s
  const notes=measures.flatMap(m=>[{time:m,midi:60,duration:.5},{time:m+1,midi:62,duration:.5}]);
  const levels=buildLevels(notes,measures);
  assert.deepEqual(levels.filter(l=>!l.boss).map(l=>[l.start,l.end]),[[0,4],[4,8],[8,12],[12,16],[16,20]]);
  assert.equal(levels[4].boss,true); assert.equal(levels[4].section,0);
  assert.deepEqual([levels[4].start,levels[4].end],[0,16]);
});
test('intro silencieuse : pas de niveau vide, départ sur la première note',()=>{
  const levels=buildLevels([{time:9.5,midi:60,duration:.5},{time:11,midi:62,duration:.5}],[0,2,4,6,8,10,12]);
  assert.equal(levels.filter(l=>!l.boss).length,1);
  assert.equal(levels[0].start,9.5);
});
test('aperçu freemium : rien après previewEnd',()=>{
  const measures=[0,2,4,6,8];
  const notes=[0,1,2,3,4,5,6,7,8,9].map(t=>({time:t,midi:60,duration:.4}));
  const levels=buildLevels(notes,measures,{previewEnd:5});
  assert.ok(levels.every(l=>l.end<=5&&l.notes.every(n=>n.time<5)));
});
test('sans mesures : fenêtres de 6 s',()=>{
  const notes=[0,3,6.2,9,12.5].map(t=>({time:t,midi:60,duration:.3}));
  assert.equal(buildLevels(notes,[]).filter(l=>!l.boss).length,3);
});
test('jugement, combo, étoiles, XP',()=>{
  assert.equal(judge(.08),'perfect'); assert.equal(judge(-.16),'good'); assert.equal(judge(.161),'miss');
  assert.deepEqual([9,10,20,40].map(multiplier),[1,2,3,4]);
  assert.equal(starsFor(.96,1),3); assert.equal(starsFor(.96,.8),2); assert.equal(starsFor(.8,1),2);
  assert.equal(starsFor(.6,.6),1); assert.equal(starsFor(.59,1),0);
  assert.equal(xpFor({notes:20,accuracy:.9,speed:1,boss:false}),180);
  assert.equal(xpFor({notes:20,accuracy:.9,speed:1,boss:true}),280);
  assert.equal(xpFor({notes:20,accuracy:.5,speed:1,boss:true}),100);
});
test('accords groupés à 60 ms',()=>{
  const attacks=groupAttacks([{time:1,midi:40},{time:1.03,midi:47},{time:1.5,midi:52}]);
  assert.deepEqual(attacks.map(a=>a.midis),[[40,47],[52]]);
});
```

- [ ] **Step 2 :** `node --test tests/learn-core.test.js` → ÉCHEC (module absent)
- [ ] **Step 3 : implémenter `learn-core.js`.** Découpage : grouper les mesures par 2. Un groupe < 4 s absorbe la mesure suivante ; un groupe > 10 s est redécoupé mesure par mesure. Couper à `previewEnd`, retirer les groupes sans note, puis caler `start` sur la première note quand le silence de tête dépasse 2 s. `xpFor` borne `notes` à 300, `accuracy` à [0,1] et `speed` à [0,6 ; 1] ; le bonus boss demande `starsFor(...) >= 1`.
- [ ] **Step 4 :** `node --test tests/learn-core.test.js` → PASS
- [ ] **Step 5 :** commit `feat(apprendre): règles du jeu (niveaux, jugement, étoiles, XP)`

### Tâche 2 : Progression serveur (`lib/learn.js`, route `/api/learn`)

**Files :**
- Create : `lib/learn.js`
- Modify : `api/jobs.js` (au début du handler : `if(req.query?.route==='learn')return learnRoute(req,res);`), `vercel.json` (réécriture), `dev/server.js` (simulation de `/api/learn` en mémoire)
- Test : `tests/learn.test.js` (faux `db` en mémoire sur le modèle de `tests/billing-store.test.js`)

**Interfaces :**
- Consumes : `starsFor`, `xpFor` de `backend/web/learn-core.js` (Tâche 1) ; `trackFilter`, `isId`, `PREVIEW_SECONDS` de `lib/track-jobs.js` ; `authenticated`, `json` de `lib/session.js`.
- Produces :
  - `nextStreak(streak:{count,last_day}|null, day:'YYYY-MM-DD') -> {count,last_day}`
  - `saveResult(db, user, {id, version, level, boss, notes, accuracy, speed, mic, day, end}) -> {level:{stars,checked,best_accuracy,best_speed,attempts}, xp_gained, xp_total, streak}`
  - `getProgress(db, user, {id, version}) -> {levels, xp, xp_total, streak}`
  - `recordUnlockClick(db, user, {id, version}) -> void`
  - `learnStats(db, since:Date) -> {players, levels_done, songs, mic_share, unlock_clicks}`
  - `learnRoute(req, res)` : `GET ?id&version` → `getProgress` ; `POST {action:'result'|'unlock', …}`.
- Document `learn_progress` : `{user_id, job_id, version, levels:{[n]:{stars,checked,best_accuracy,best_speed,attempts,mic,completed_at}}, xp, unlock_clicks, created_at, updated_at}`, index unique `{user_id:1, job_id:1, version:1}`. Utilisateur : `learn_xp_total`, `learn_streak`.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
test('série : même jour inchangée, lendemain +1, trou → 1',()=>{
  assert.deepEqual(nextStreak(null,'2026-11-22'),{count:1,last_day:'2026-11-22'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-22'),{count:3,last_day:'2026-11-22'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-23'),{count:4,last_day:'2026-11-23'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-22'},'2026-11-25'),{count:1,last_day:'2026-11-25'});
  assert.deepEqual(nextStreak({count:3,last_day:'2026-11-30'},'2026-12-01'),{count:4,last_day:'2026-12-01'});
});
test('valeurs bornées, étoiles recalculées, meilleur résultat conservé',async()=>{
  const {db,user,job}=setup();                       // job terminé appartenant à user
  const a=await saveResult(db,user,{id:job,version:'direct',level:0,notes:20,accuracy:5,speed:3,mic:true,day:'2026-11-22',end:4});
  assert.equal(a.level.stars,3); assert.equal(a.level.best_accuracy,1); assert.equal(a.level.best_speed,1);
  const b=await saveResult(db,user,{id:job,version:'direct',level:0,notes:20,accuracy:.7,speed:1,mic:true,day:'2026-11-22',end:4});
  assert.equal(b.level.stars,3); assert.equal(b.level.attempts,2);
});
test('sans micro : coche, pas d\'étoile, pas d\'XP',async()=>{
  const {db,user,job}=setup();
  const r=await saveResult(db,user,{id:job,version:'direct',level:0,notes:20,accuracy:1,speed:1,mic:false,day:'2026-11-22',end:4});
  assert.equal(r.level.stars,0); assert.equal(r.level.checked,true); assert.equal(r.xp_gained,0);
});
test('aperçu freemium : niveau au-delà de 30 s refusé',async()=>{
  const {db,user,job}=setup({preview_limit:30,preview_duration:30});
  await assert.rejects(saveResult(db,user,{id:job,version:'direct',level:9,notes:10,accuracy:1,speed:1,mic:true,day:'2026-11-22',end:34}),/aperçu/);
});
test('morceau d\'un autre compte : introuvable',async()=>{
  const {db,job}=setup(); const other={_id:new ObjectId(),role:'user'};
  await assert.rejects(saveResult(db,other,{id:job,version:'direct',level:0,notes:5,accuracy:1,speed:1,mic:true,day:'2026-11-22',end:4}),/introuvable/);
});
```

- [ ] **Step 2 :** `node --test tests/learn.test.js` → ÉCHEC
- [ ] **Step 3 : implémenter `lib/learn.js` et brancher la route.**
  - Le job est cherché avec `trackFilter(id,user)` et `status:'completed'` ; sinon `Error('Morceau introuvable.')` → 404.
  - Si le job a `preview_limit` et que `end > preview_duration + 0.5` → `Error('Niveau hors de ton aperçu.')` → 403.
  - `version` doit correspondre à `/^[a-z0-9_-]{1,24}$/`, `level` être un entier entre 0 et 500, et `day` correspondre à `/^\d{4}-\d{2}-\d{2}$/`.
  - Sans session, la route renvoie 401. `learnStats` compte sur `updated_at >= since`.
  - Dans `dev/server.js`, simuler GET et POST en mémoire avec la même forme de réponse (en réutilisant `nextStreak`, `starsFor` et `xpFor`).
- [ ] **Step 4 :** `node --test tests/` → PASS (tous les tests existants inclus)
- [ ] **Step 5 :** commit `feat(apprendre): progression, série et XP côté serveur`

### Tâche 3 : Détection au micro (`learn-audio.js`)

**Files :**
- Create : `backend/web/learn-audio.js` (UMD : `window.TablurioLearnAudio` + `module.exports` pour les fonctions pures)
- Test : `tests/learn-audio.test.js` (signaux synthétiques : sinusoïdes + harmoniques, 44 100 Hz)

**Interfaces :**
- Produces :
  - `detectPitch(samples:Float32Array, sampleRate) -> {freq:number, clarity:number}|null` (YIN ; `null` sous le seuil d'énergie ou si clarity < 0,8)
  - `midiOf(freq) -> number` (fractionnaire)
  - `matchesNote(freq, midi) -> boolean` (±50 cents, à l'octave près)
  - `chroma(magnitudes:Float32Array, sampleRate, fftSize) -> Float32Array(12)` (normalisé, max = 1)
  - `matchesChord(chromaVec, midis:number[], threshold=0.35) -> boolean` (≥ 60 % des classes de note attendues au-dessus du seuil)
  - `class MicListener { static supported():boolean; async start():void; stop():void; calibrate(ms=5000):Promise<{ok:boolean, level:number}>; onFrame(cb:({pitch, chroma, onset:boolean, level})=>void) }`. Utilise `getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}})`, un `AnalyserNode` avec fftSize 4096 et une boucle `requestAnimationFrame`. Une attaque est détectée quand l'énergie RMS dépasse 1,8 × sa moyenne glissante sur 300 ms et le seuil de bruit calibré.

- [ ] **Step 1 : écrire les tests qui échouent**

```js
const tone=(f,sr=44100,n=4096,harm=[1,.5,.3])=>Float32Array.from({length:n},(_,i)=>harm.reduce((s,a,k)=>s+a*Math.sin(2*Math.PI*f*(k+1)*i/sr),0)*.3);
test('YIN trouve le La 440 et le Mi grave de guitare',()=>{
  assert.ok(Math.abs(detectPitch(tone(440),44100).freq-440)<3);
  assert.ok(Math.abs(midiOf(detectPitch(tone(82.41),44100).freq)-40)<.5);
});
test('silence → null',()=>assert.equal(detectPitch(new Float32Array(4096),44100),null));
test('note : ±50 cents, octave tolérée',()=>{
  assert.ok(matchesNote(440,69)); assert.ok(matchesNote(880,69)); assert.ok(matchesNote(452,69));
  assert.ok(!matchesNote(466.16,69));
});
test('accord : 60 % des classes attendues',()=>{
  const c=new Float32Array(12); c[4]=1; c[11]=.8;            // Mi + Si présents, Sol# absent
  assert.ok(matchesChord(c,[40,47,56,64]));                 // classes {4,11,8} → 2/3 ≥ 60 %
  const one=new Float32Array(12); one[4]=1;
  assert.ok(!matchesChord(one,[40,47,56]));                 // 1/3
});
```
Plus un test `chroma` : un spectre synthétique (une FFT simple dans le test, ou des magnitudes construites à la main aux bins de 196 Hz et 246,9 Hz) doit donner un maximum aux classes 7 et 11.

- [ ] **Step 2 :** `node --test tests/learn-audio.test.js` → ÉCHEC
- [ ] **Step 3 : implémenter.** Plage YIN 60–1400 Hz, seuil 0,15, interpolation parabolique. Chroma sur les bins de 60 à 2000 Hz, pondéré par la magnitude et replié sur les 12 classes.
- [ ] **Step 4 :** `node --test tests/learn-audio.test.js` → PASS
- [ ] **Step 5 :** commit `feat(apprendre): détection des notes et accords au micro`

### Tâche 4 : Entrée, route et carte du morceau

**Files :**
- Create : `backend/web/learn-mode.js`, `backend/web/learn-mode.css`
- Modify : `index.html` (`parseAppPath`/`appPath`/`renderRoute`, bouton dans `.score-bar` des deux vues, chargement paresseux), `backend/web/score-player.js` (exposer `tabNotes` : `window.SongToSheetPlayer={mount,tabNotes}`, sans autre changement)

**Interfaces :**
- Consumes : `buildLevels`, `groupAttacks` (Tâche 1) ; `/api/learn` (Tâche 2) ; `window.SongToSheetPlayer.tabNotes(xml,bpm)` ; `window.Midi` via `/api/player-assets?asset=midi&v=2.0.28` ; `window.SongToSheetCurrentUser`.
- Produces : `window.TablurioLearn.mount(root, {job, version, midiUrl, xmlUrl, instrument, previewEnd, backHref}) -> dispose()`. `version` vaut `'direct'|'solo'|'rhythm'|<choix piano>`. `parseAppPath('/app/<id>/apprendre')` renvoie `{page:'learn', id}` et `appPath('learn',id)` renvoie `/app/<id>/apprendre`.

- [ ] **Step 1 : router.** Étendre la regex de `parseAppPath` à un second segment optionnel `apprendre`. `renderRoute` affiche une page `#learn-page` (plein écran, sans la barre latérale) et appelle `loadLearn(id)`. Celle-ci récupère le job par `/api/jobs/<id>`, choisit l'URL de version comme le fait `mountVersion` (`mid`/`solomid`/`rhythmmid` et `musicxml`/`tab`/`solotab`/`rhythmtab`), charge `learn-core.js`, `learn-audio.js` et `learn-mode.js?v=1`, puis appelle `mount`. Visiteur non connecté → `/inscription`.
- [ ] **Step 2 : bouton.** Dans `summary` (vue `ready`), `<a class="btn btn-outline score-learn" href="/app/<id>/apprendre" data-learn>🎮 Apprendre</a>` avant `.score-download`. Sur la vue comparaison, le lien porte la version affichée (`?version=`).
- [ ] **Step 3 : carte du morceau** dans `learn-mode.js` :
  - un en-tête (← Partition, titre · instrument, 🔥 série, ⚡ XP) ;
  - des sections et un chemin sinueux de pastilles SVG (faite ★, en cours = anneau qui pulse, verrouillée 🔒, boss 👑) ;
  - une barre de progression du morceau en % ;
  - un bouton `▶ Continuer : Niveau n`.

  Pour le freemium (`previewEnd` fini et `sourceDuration > previewEnd`), afficher 4 pastilles verrouillées floutées et une carte avec le CTA `Débloquer la suite du morceau` (`href="/upgrade" data-unlock`). Un clic sur ce CTA fait un POST `{action:'unlock'}`. Pour les comptes payés, reprendre les libellés de `drawSheet()` (« Générer la suite », attente Starter).
- [ ] **Step 4 : vérifier** avec `node dev/server.js` : ouvrir `http://localhost:4173/app/exemple-apercu`, cliquer `🎮 Apprendre`, puis vérifier à l'écran la carte, l'état verrouillé après 30 s et le retour vers la partition. Sur `exemple-complet`, aucun verrou. Capture d'écran sur desktop et en 390 px de large.
- [ ] **Step 5 :** `node --test tests/` → PASS ; commit `feat(apprendre): entrée, route et carte du morceau`

### Tâche 5 : Boucle de jeu (Écoute, Entraîne, Défi, résultat)

**Files :**
- Modify : `backend/web/learn-mode.js`, `backend/web/learn-mode.css`

**Interfaces :**
- Consumes : `groupAttacks`, `judge`, `multiplier`, `starsFor`, `SPEEDS`, `LISTEN_SPEED` (Tâche 1) ; `MicListener`, `matchesNote`, `matchesChord` (Tâche 3) ; POST `/api/learn {action:'result', id, version, level, boss, notes, accuracy, speed, mic, day, end}` (Tâche 2).
- Produces : rien de plus pour les autres tâches.

- [ ] **Step 1 : moteur de lecture.** Charger les échantillons de `backend/web/sounds/` (profils de `score-player.js` : `guitar-steel/`, `piano-grand/`) pour jouer les notes d'un niveau à une vitesse donnée, avec un clic de métronome (oscillateur court) au temps.
- [ ] **Step 2 : rendu canvas.**
  - Piano : clavier limité à l'étendue du niveau ±2 demi-tons, notes qui tombent vers une ligne de frappe ; une touche validée devient `#2ac58b`, une touche attendue `#a567ff`.
  - Guitare : 6 cordes horizontales (Mi grave en bas) et numéros de case dans des pastilles qui défilent de droite à gauche vers la ligne de frappe ; les accords forment une colonne.
  - Fond sombre et grille légère.
- [ ] **Step 3 : phases.**
  - Écoute : lecture à `LISTEN_SPEED`, sans micro.
  - Entraîne : le défilement s'arrête sur chaque `Attack` jusqu'à `matchesNote` (une seule note) ou `matchesChord` (plusieurs notes) sur des frames pendant 120 ms. Après 3 ratés à la suite (attaque détectée mais fausse), afficher le nom de la note et la case ou la touche.
  - Défi : défilement continu à la vitesse choisie (`SPEEDS`, la dernière réussie est mémorisée). Chaque attaque est jugée par `judge(hitTime-expected/speed)` sur la première frame détectée qui correspond dans ±160 ms ; sinon `miss`. Afficher combo, multiplicateur et le texte « Parfait / Bien / Raté » en pop.
- [ ] **Step 4 : résultat.** Carte blanche, étoiles qui tombent une à une, précision %, meilleur combo, XP renvoyée par le serveur, confettis à 3★ (sans confettis si `prefers-reduced-motion`), puis `Rejouer` et `Niveau suivant`. Les boss jouent toute la section en Défi seulement, avec la couronne à la clé. On envoie `day` en date locale `YYYY-MM-DD` et `end` = fin du niveau.
- [ ] **Step 5 : vérifier** dans `node dev/server.js`. Jouer un niveau en mode sans micro (Tâche 6) ou avec un micro simulé : dans la console, `TablurioLearn._debugFeed(midis)` injecte une détection et n'est exposé qu'en `localhost`. Les trois phases s'enchaînent, le résultat s'affiche et la carte se met à jour. Capture d'écran.
- [ ] **Step 6 :** commit `feat(apprendre): boucle de jeu Écoute / Entraîne / Défi`

### Tâche 6 : Accès au micro, calibrage et mode sans micro

**Files :**
- Modify : `backend/web/learn-mode.js`, `backend/web/learn-mode.css`

**Interfaces :**
- Consumes : `MicListener.supported/start/calibrate` (Tâche 3).

- [ ] **Step 1 : écran d'explication** avant la première demande (texte exact : « Tablurio écoute ton instrument pour valider tes notes. Rien n'est enregistré ni envoyé. » et « Avec des écouteurs, c'est encore plus précis. »), puis le calibrage (« Joue une note », jauge de niveau, 5 s). Le choix est mémorisé dans `localStorage` (`tablurio_learn_mic`).
- [ ] **Step 2 : son guide.** Interrupteur `Son guide 🎧`, coupé par défaut en Entraîne et en Défi.
- [ ] **Step 3 : mode sans micro** (refus, `!MicListener.supported()`, échec du calibrage). Entraîne avance au clic ou à la touche espace sur chaque note, et le Défi est remplacé par le bouton `Je l'ai joué ✓`. Le résultat est envoyé avec `mic:false` et s'affiche comme une coche. Un bandeau « Active le micro pour gagner des étoiles » relance l'étape 1.
- [ ] **Step 4 : vérifier** dans le navigateur : refuser le micro → mode libre, niveau coché, niveau suivant débloqué.
- [ ] **Step 5 :** commit `feat(apprendre): micro, calibrage et mode sans micro`

### Tâche 7 : Anglais et KPI admin

**Files :**
- Modify : `assets/i18n-en.js` (tous les textes du jeu), `api/health.js` (ajouter `learn: await learnStats(db, since)` à la réponse `stats`), `admin.html` (panneau « Apprentissage »)
- Test : `tests/learn.test.js` (ajout)

**Interfaces :**
- Consumes : `learnStats` (Tâche 2).

- [ ] **Step 1 : test qui échoue**

```js
test('learnStats : joueurs, niveaux, part micro, clics déblocage',async()=>{
  const {db,user,job}=setup();
  await saveResult(db,user,{id:job,version:'direct',level:0,notes:10,accuracy:1,speed:1,mic:true,day:'2026-11-22',end:4});
  await saveResult(db,user,{id:job,version:'direct',level:1,notes:10,accuracy:1,speed:1,mic:false,day:'2026-11-22',end:8});
  await recordUnlockClick(db,user,{id:job,version:'direct'});
  assert.deepEqual(await learnStats(db,new Date(0)),{players:1,levels_done:2,songs:1,mic_share:.5,unlock_clicks:1});
});
```
- [ ] **Step 2 :** `node --test tests/learn.test.js` → ÉCHEC, puis implémenter et revoir PASS
- [ ] **Step 3 : panneau admin.** Ajouter `<section class="panel"><h2>Apprentissage</h2><p>Joueurs et niveaux terminés sur la période.</p>…</section>` avec 5 chiffres, dans le style `.kpi`. Si `data.learn` est absent, le panneau n'apparaît pas.
- [ ] **Step 4 : anglais.** Passer l'interface en anglais (sélecteur de langue) et parcourir la carte, les phases et le résultat : aucun texte français ne doit rester.
- [ ] **Step 5 :** `node --test tests/` → PASS ; commit `feat(apprendre): traduction anglaise et KPI admin`
