# SongToSheet.ai

**SaaS B2C de transcription musicale — prototype V1.**

> **Tarifs de la démo (novembre 2026)** : Essentiel à 10 €/mois pour 1 transcription tous les 7 jours (78 €/an), Illimité à 19 €/mois (148,20 €/an), À vie à 99 € en paiement unique. L'annuel inclut −35 % de réduction. Les paiements et les droits d'abonnement ne sont **pas actifs** sur le site public. Le backend expérimental sous `backend/` contient encore un ancien modèle de crédits et ne doit pas être présenté comme le système commercial. Voir [PRICING.md](PRICING.md) pour les règles cibles et les travaux nécessaires avant la vente.

## Site marketing — pages distinctes

La V1 utilise un routeur client et des réécritures Vercel : chaque page dispose d'une URL directe et rechargeable.

- `/` : landing avec une promesse, un CTA, la saisie de lien/audio et une illustration horizontale → partition verticale.
- `/fonctionnalites` : présentation du processus et des exports.
- `/resultats` : démonstration de mélodie originale, **pas des témoignages clients**.
- `/tarifs` : grille de prix (10 €/mois, 19 €/mois, 99 € à vie ; −35 % en annuel) et tableau comparatif.
- `/faq` : limites, compatibilité, formats et questions d'abonnement.

Les plans ne sont **pas** affichés sur l'accueil. L'espace studio présente les formules au moment de la génération (démo, sans paiement réel).

## Persistance de comptes et créations

- L'inscription et la connexion sont désormais traitées par des routes Node.js Vercel, avec mots de passe salés et hachés (scrypt) en collection `songtosheet.users`.
- Une génération simulée terminée avant inscription est rattachée au compte et enregistrée dans `songtosheet.generations`, avec le titre, la source, l'instrument, le format (partition/tablature), la durée, la date et l'état de révélation de l'aperçu.
- Après connexion, les générations sont consultables dans la bibliothèque, y compris sur un autre appareil. L'aperçu ne devient visible qu'après clic sur « Générer mon aperçu » dans le compte.
- Seules les métadonnées sont conservées : les fichiers audio et les transcriptions réelles ne sont pas encore traités. Les anciens comptes fictifs stockés en session ne sont pas migrés automatiquement.

## Deux parties complémentaires

- **Site Vercel et fonctions Node.js** : landing, API de métadonnées, authentification et sauvegarde réelle des demandes de démonstration dans MongoDB, mais simulation visuelle du relevé musical et paiement désactivé.
- **Moteur expérimental local** : `backend/` contient le prototype FastAPI et ses tests de transcription monophonique et exports, non connecté au parcours public.

## Tunnel de conversion V1 (novembre 2026)

Parcours : lien ou fichier → instrument → partition/tablature → animation fictive (~18 s) → inscription ou connexion → compte et bibliothèque → « Générer mon aperçu » → aperçu de démonstration limité à 30 secondes, suite floutée et bouton d'accès aux offres.

- **Aucune transcription réelle n'est produite.** Le relevé visible est une mélodie originale illustrative qui ne provient pas de la vidéo ou du fichier. Les achats et exports réels restent désactivés.
- Les fichiers audio sont limités à 25 Mo. La durée est lue dans le navigateur quand les métadonnées sont disponibles.
- Les routes `/generation`, `/apercu`, `/inscription`, `/connexion` et `/app` sont rechargeables grâce aux rewrites Vercel. Les sessions sont stockées en cookies signés et les générations réelles dans MongoDB.
- Code front-end : `index.html`, `assets/conversion-flow.js` et `assets/conversion-flow.css`.

### Parcours de sélection et métadonnées (novembre 2026)

- Clic sur « Continuer » depuis la landing → lecture des métadonnées publiques via `api/media-info.js` (titre, auteur, miniature et durée **si disponible**) → `/choisir-instrument` → **`/choisir-format` : partition ou tablature** → simulation progressive de **18 secondes** → écran prêt sans révéler la durée limitée → inscription réelle → bibliothèque → clic « Générer mon aperçu » → aperçu illustratif limité de 30 secondes. Le choix du format est conservé dans le `sessionStorage`, présenté dans la progression et l'écran prêt ; l'aperçu utilise une portée pour la partition et un exemple original à cordes/cases pour la tablature.
- Pour les **fichiers**, vérification de 25 Mo dès l’import, avec erreur sous le champ sur la landing.
- Pour les **liens**, la durée et les autres métadonnées sont affichées quand elles sont disponibles. L’aperçu public reste accessible sans durée vérifiée. Le moteur de transcription de la bêta administrateur accepte les vidéos YouTube accessibles et les liens HTTPS directs vers un audio.
- Les miniatures et titres proviennent de métadonnées publiques, mais l'aperçu reste **une partition illustrative non liée au morceau**, le traitement audio réel n'étant pas activé. Aucun achat ni compte durable n'est créé.

## Déploiement

Site Vercel avec fonctions Node.js sous `api/`, dépendances `package.json` et pages HTML statiques. La configuration nécessite les variables `MONGODB_URI` (secret serveur) et `MONGODB_DB_NAME=songtosheet`. Une clé distincte `AUTH_SESSION_SECRET` est recommandée ; sans elle, une clé de signature dérivée du secret MongoDB est utilisée. Ne jamais exposer les secrets dans le front-end.

## Faire tourner le moteur en local

Nécessite Python 3.11/3.12 et FFmpeg.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Remplacer SESSION_SECRET dans .env
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Voir [backend/README.md](backend/README.md) pour le détail du backend et le lancement des tests.

## Limites importantes

La base MongoDB sert aujourd'hui à stocker de **vrais comptes** et les **demandes de génération simulées**, pas des partitions générées par IA. Le moteur de transcription, l'import audio distant, les téléchargements PDF/MIDI/MusicXML et les paiements ne sont pas encore activés sur le site public.

L'accès au cluster Atlas est partagé avec d'autres projets mais les droits du compte applicatif sont limités à la base `songtosheet`. Les collections `users` et `generations` disposent d'index d'identification et de rattachement, et `/api/health` permet de vérifier la connexion. Avant commercialisation : renforcer la protection contre le spam, configurer des sauvegardes, restreindre autant que possible l'accès réseau et intégrer une vraie infrastructure de traitement musical.

## Authentification et conversions V1 (novembre 2026)

**Nouveau parcours :** lien/fichier → instrument → partition ou tablature → animation de génération (maquette uniquement) → inscription (ou connexion) → **bibliothèque personnelle** avec la création préparée → clic sur « Générer mon aperçu » → **seulement alors** révélation du quota de 30 secondes, suite illustrative floutée et CTA « Débloquer la partition/tablature complète ». La transcription audio et l'achat d'accès ne sont pas encore disponibles : le prototype ne doit pas prétendre produire une véritable partition du morceau importé.

**Enregistrement réel des comptes :** le site utilise maintenant des routes Vercel Node.js liées à MongoDB Atlas : `/api/auth/signup`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/jobs`, `/api/jobs/:id`. Les comptes sont stockés en collection `users` avec un hash salé scrypt (pas de mot de passe en clair) et un cookie signé HttpOnly/Secure/SameSite=Lax. Les générations simulées sont conservées en collection `generations`, liées à un `user_id` MongoDB et avec une clé idempotente `client_generation_id`. La lecture et l'action de révélation appliquent un filtre serveur sur l'utilisateur connecté. Un frein aux tentatives de connexion est stocké dans `login_limits`.

Les dépendances du serveur se trouvent dans `package.json` (`mongodb`). Les secrets sont **exclusivement dans les variables Vercel chiffrées**, jamais dans Git ou le navigateur : `MONGODB_URI` (identifiant de base limité à la base `songtosheet`) et `MONGODB_DB_NAME=songtosheet`. En complément, un `AUTH_SESSION_SECRET` dédié est recommandé pour dissocier la clé de signature des cookies du secret de la base. MongoDB et son accès réseau doivent rester restreints et surveillés avant l'ouverture commerciale. La configuration de production peut nécessiter un nouveau déploiement lors de la modification des variables.

**Migration :** les anciens « comptes » de démo locaux (email stocké en session) ne sont pas de vrais comptes. Ils doivent créer un compte avec un vrai mot de passe. Les créations stockées en local ne sont pas automatiquement migrées vers MongoDB. Vérifier le flux de création, session, stockage, rechargement, séparation entre comptes et reprise après erreur avant acquisition payante.
