# Mode Apprentissage — « Apprendre ce son »

Date : 22/11/2026 · Statut : en attente d'approbation de Tanguy

## Intention

Après avoir généré un morceau, l'utilisateur peut l'apprendre étape par étape dans un **jeu**. Il doit comprendre tout de suite que c'est un jeu (progression, étoiles, combos, récompenses), et en ressortir en sachant vraiment jouer son morceau. Le jeu doit être beau et fidèle à la DA Tablurio.

Pourquoi : c'est ce qui transforme « j'ai une partition » en « je joue mon son ». Ça fait revenir les utilisateurs et donne une raison de plus de payer pour le morceau entier.

## Objectifs

- Un parcours de niveaux par morceau. Chaque niveau couvre un court passage, travaillé en trois phases : Écoute → Entraîne → Défi.
- Le jeu **écoute l'utilisateur au micro** et valide les notes réellement jouées, sur la guitare et le piano.
- Score, étoiles (1 à 3), combo, XP, série de jours, déblocage progressif, boss de fin de section, célébration visuelle.
- La progression est enregistrée en base et suit l'utilisateur d'un appareil à l'autre.
- Le jeu fonctionne sur mobile (le trafic vient de TikTok et d'Instagram).
- Bilingue FR/EN, avec le mécanisme i18n existant.

## Non-objectifs (v1)

- Classements entre joueurs, partage du score, défis entre amis.
- Basse, batterie, violon (déjà en bêta, non sélectionnables).
- Édition des notes ou correction de la transcription.
- Nouveau calcul côté moteur (Modal) : tout se fait dans le navigateur à partir des exports existants.

## Anti-objectifs (échec même si « ça marche »)

- Un coût par utilisation : aucune API payante, aucun appel GPU, pas de serveur d'analyse audio.
- Le moindre changement visuel ou fonctionnel sur l'écran partition actuel, hormis le bouton d'entrée.
- La suite du morceau envoyée à un compte freemium : le jeu n'utilise que le MIDI que le serveur sert déjà (30 s pour le freemium).
- Un jeu qui compte faux en permanence. Si la détection doute, on donne le point : mieux vaut être généreux que frustrant.
- Un écran qui ressemble à un outil et pas à un jeu.

## Contraintes

- Open source uniquement, sans coût d'API (règle produit de Tanguy).
- Le compte Vercel est déjà à **12 fonctions** dans `api/`, la limite du plan Hobby. Les nouvelles routes passent donc par une réécriture vers une fonction existante, comme `/api/collect` → `api/health.js?route=collect`.
- La génération actuelle reste la même : l'admin voit le morceau entier et le freemium ses 30 s.
- Le code front reste du JS vanilla sans build, dans le style de `backend/web/score-player.js`.

## Approches envisagées

| | Approche | Compromis |
|---|---|---|
| **A — retenue** | Vue « mode jeu » plein écran, avec sa propre URL `/app/<id>/apprendre`, ouverte depuis l'écran partition | Le plus immersif ; écran partition intact ; c'est le plus gros chantier |
| B | Un onglet « Apprendre » dans le lecteur actuel | Rapide, mais coincé dans l'écran partition : on ne sent pas le jeu |
| C | Une page séparée hors de l'app | Libre visuellement, mais il faut refaire la connexion et la navigation |

Tanguy a choisi A (22/11/2026). Il a aussi validé le micro, avec un mode sans micro en secours.

## Expérience

### Entrée

- Bouton **🎮 Apprendre** dans la barre de l'écran partition (`.score-bar`), dès qu'un relevé est prêt, sur la vue simple comme sur la vue comparaison.
- La vue jeu utilise la version actuellement affichée : guitare originale, solo ou rythmée, ou version piano choisie. Elle prend le MIDI correspondant et la notation (tablature pour la guitare, sinon partition).
- Visiteur non connecté : le bouton mène à l'inscription, avec le même message que le teaser actuel.

### Carte du morceau (écran d'accueil du jeu)

```
┌──────────────────────────────────────────────────────┐
│ ← Partition     Wonderwall · Guitare       🔥 3 j  ⚡ 1 240 XP │
│                                                      │
│  SECTION 1 ───────────────────────────────           │
│   (★★★)──(★★☆)──(◐ 3)──(🔒 4)──(👑 Boss)            │
│  SECTION 2                                           │
│   (🔒)──(🔒)──(🔒)──(🔒)──(👑)                       │
│  [🔒 Suite du morceau — Débloquer]   ← freemium      │
│                                                      │
│   Progression du morceau ▓▓▓▓░░░░░░ 32 %             │
│              [ ▶ Continuer : Niveau 3 ]              │
└──────────────────────────────────────────────────────┘
```

- Chemin sinueux de « pastilles », façon Duolingo : faites (étoiles), en cours (anneau qui pulse), verrouillées.
- **Niveau** = environ 2 mesures, ajusté pour durer 4 à 10 s selon le tempo (7 à 25 notes environ).
- **Section** = 4 niveaux, puis un **Boss** qui fait enchaîner toute la section à vitesse réelle. Un boss réussi donne une couronne et un bonus d'XP.
- On débloque le niveau suivant avec 1 étoile. Rejouer un niveau pour gagner plus d'étoiles est toujours possible.
- **Freemium** : seuls les niveaux couverts par les 30 s sont jouables. La suite est affichée en pastilles verrouillées, floutées, avec le CTA existant « Débloquer la suite du morceau » (`/upgrade`, `data-unlock`). Les comptes payés voient le même verrou que sur l'écran partition (« Générer la suite », Starter en attente…).

### Un niveau : trois phases

1. **Écoute** : le passage est joué au son de l'instrument (échantillons existants) à 0,75×, et les notes défilent jusqu'à la ligne de frappe. Pas de micro. On peut réécouter ou passer.
2. **Entraîne** (mode « attente ») : le défilement s'arrête sur chaque note ou accord et repart dès que le micro l'entend. Pas de chrono. Chaque note réussie s'allume en vert, avec une petite étincelle et un « ding ». En dessous de 3 ratés à la suite, on montre la note (nom, case, touche).
3. **Défi** : défilement continu au tempo choisi (0,6× → 0,8× → 1× ; la vitesse réussie est retenue). Fenêtre de jugement **Parfait** ±80 ms, **Bien** ±160 ms, **Raté** au-delà. Barre de combo, multiplicateur ×2 / ×3 / ×4 à 10 / 20 / 40 notes de suite.

Fin de niveau : écran de résultat avec les étoiles qui tombent une à une, la précision en %, le meilleur combo, l'XP gagnée et des confettis à 3★. Boutons « Rejouer » et « Niveau suivant ».

Étoiles (Défi) : 1★ ≥ 60 % de notes réussies, 2★ ≥ 80 %, 3★ ≥ 95 % **à 1×**. À vitesse réduite, le maximum est 2★, pour donner envie de monter la vitesse.

XP : 10 par note Bien, 15 par Parfait, × multiplicateur de combo ; +100 pour un boss réussi. **Série** : nombre de jours consécutifs avec au moins un niveau terminé (fuseau du navigateur).

### Vue de jeu

- **Piano** : notes qui tombent sur un clavier, une barre violette par note dont la longueur suit la durée. On réutilise le style de `.sp-keyboard` et les couleurs de touche jouée (`#a567ff`). Clavier limité à l'étendue du passage, avec une marge, pour rester lisible sur mobile.
- **Guitare** : autoroute horizontale de 6 cordes où les numéros de case défilent vers la ligne de frappe, avec la corde et la case issues de la tablature MusicXML (`technical string/fret`). Les accords forment une colonne de cases. Le nom d'accord s'affiche quand il est connu (mode « accords »).
- Ambiance **sombre « scène »**, reprise du hero sombre de la landing (`#090712` → `#130b2d`, lueurs violettes, grille légère). Accents `--purple #7549eb`, vert de réussite `#2ac58b`, police Inter. Les cartes (carte du morceau, résultats) restent blanches et arrondies, comme le reste du site.
- Animations en CSS et canvas 2D, 60 fps visés. On respecte `prefers-reduced-motion` : pas de confettis, défilement conservé.

### Micro

- L'accès au micro est demandé au premier passage en Entraîne, avec un écran d'explication : « Tablurio écoute ton instrument pour valider tes notes. Rien n'est enregistré ni envoyé. » Plus un conseil : « Avec des écouteurs, c'est encore plus précis. »
- **Écran de calibrage** de 5 s (« Joue une note ») : il vérifie le niveau du signal et règle le seuil de bruit.
- Pendant Entraîne et Défi, **le son guide est coupé par défaut** pour que le micro n'entende pas le jeu lui-même. On garde un clic de métronome et un interrupteur « Son guide 🎧 ».
- **Sans micro** (refus, appareil sans micro, navigateur incompatible) : mode libre. Écoute et Entraîne restent disponibles, et l'utilisateur valide lui-même chaque note ou le niveau (« Je l'ai joué ✓ »). Le niveau obtient alors une coche, sans étoiles, et débloque le suivant. Un bandeau propose de réactiver le micro.

## Détection (dans le navigateur, sans dépendance payante)

- `getUserMedia` + Web Audio (`AnalyserNode`, ou `AudioWorklet` quand c'est possible), avec l'annulation d'écho, la réduction de bruit et le gain automatique **désactivés** pour ne pas déformer l'instrument.
- **Notes seules** : estimation de hauteur par l'algorithme YIN/MPM, implémenté dans le module (une centaine de lignes, sans bibliothèque). Une note est validée si la hauteur détectée correspond à la note attendue à ±50 cents. L'octave est tolérée (une erreur d'une octave compte comme juste), parce que les harmoniques de guitare trompent souvent la détection.
- **Accords** (plusieurs notes attendues en même temps) : chromagramme (FFT → énergie par classe de note sur 12 demi-tons). L'accord est validé si au moins 60 % des classes de note attendues ressortent au-dessus du seuil, sans exigence sur l'octave.
- Détection d'attaque (montée d'énergie) pour dater les coups en Défi. En Entraîne, la hauteur maintenue suffit.
- Si la détection doute (signal faible ou instable), la note ne compte pas comme ratée en Entraîne, on attend. En Défi, elle compte comme ratée seulement si rien n'a été détecté dans la fenêtre.

## Données et API

- Nouvelle collection MongoDB `learn_progress`, un document par (utilisateur, morceau) :
  `{user_id, job_id, version, levels: {"0": {stars, best_accuracy, best_speed, attempts, completed_at}}, boss: {...}, xp, created_at, updated_at}`. Index unique `{user_id, job_id, version}`.
- Sur l'utilisateur (`users`) : `learn_xp_total`, `learn_streak {count, last_day}`.
- Routes, sans nouvelle fonction Vercel. Une réécriture `/api/learn` → `/api/jobs?route=learn` (le choix de la fonction hôte revient au développeur, tant qu'il n'y en a pas de nouvelle) :
  - `GET /api/learn?id=<job>&version=<v>` : progression + série + XP total.
  - `POST /api/learn` `{id, version, level, accuracy, speed, mic: bool}` : le serveur recalcule lui-même les étoiles et l'XP à partir de `accuracy` et `speed` (on ne fait pas confiance au client pour les étoiles), borne les valeurs, met à jour la série, et ne garde que le meilleur résultat.
  - Le serveur vérifie que le job appartient à l'utilisateur. Pour un aperçu freemium, il refuse un niveau au-delà de la durée de l'aperçu.
- La logique pure (étoiles, XP, série, découpage) vit dans `lib/learn.js`, avec des tests `node --test` dans `tests/learn.test.js`, comme le reste de `lib/`.
- **Admin** : une carte « Apprentissage » dans le tableau de bord existant, sur 30 j. Elle affiche les joueurs actifs, les niveaux terminés, la part de morceaux ouverts en mode jeu, la part des sessions avec micro, et le nombre de freemium qui cliquent sur « Débloquer » depuis le jeu. Les événements passent par `tb-analytics` / `/api/collect` comme les autres KPI.

## Découpage en niveaux

- Source : le MIDI de la version (temps exacts) + le MusicXML (mesures, signature, corde/case).
- Mesures calculées comme dans `tabNotes()` de `score-player.js` (on réutilise ou on extrait cette fonction). On regroupe par 2 mesures, puis 1 ou 3 si le passage fait moins de 4 s ou plus de 10 s.
- Silences : un niveau qui commence par plus de 2 s de silence est recalé sur sa première note (même logique que `guitarEntry`). Un passage sans aucune note n'est pas un niveau.
- Sans MusicXML exploitable, on découpe par fenêtres de 6 s alignées sur les attaques.
- Le découpage est calculé dans le navigateur. Il est déterministe pour une même version, donc les numéros de niveau restent stables.

## Fichiers (indicatif)

- `backend/web/learn-mode.js` : vue jeu (carte, phases, rendu canvas, sons, résultat).
- `backend/web/learn-audio.js` : micro, YIN, chroma, attaques.
- `backend/web/learn-mode.css`.
- `index.html` : route `/app/<id>/apprendre` dans `parseAppPath`/`appPath`, bouton dans la `.score-bar`, chargement paresseux des scripts.
- `assets/i18n-en.js` : textes anglais.
- `lib/learn.js`, `tests/learn.test.js`, route serveur, réécriture dans `vercel.json`, carte admin.

## Laissé au développeur

- Le choix de la fonction Vercel hôte de `/api/learn`.
- L'extraction ou le partage des utilitaires de `score-player.js` (chargement des échantillons, `tabNotes`), sans changer son comportement.
- Le réglage fin des seuils de détection, à condition d'être tolérant en cas de doute.
- Le détail des micro-animations, dans la DA décrite plus haut.

## Mes choix (à vérifier par Tanguy)

1. Ambiance sombre « scène » pour la vue jeu (reprise du hero sombre), cartes blanches pour les écrans de menu.
2. Freemium : le jeu couvre les 30 s, la suite est affichée verrouillée avec le CTA de déblocage.
3. Son guide coupé par défaut quand le micro écoute, avec un conseil d'écouteurs.
4. Sans micro : niveau validé par une coche, sans étoiles.
5. 3★ seulement à vitesse réelle.
6. Progression en base (et pas seulement dans le navigateur), avec des KPI dans l'admin.
