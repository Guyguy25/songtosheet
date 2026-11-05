# Publication et aperçu sur Vercel

## Ce qui est réellement déployé

La V1 contient deux environnements distincts :

- **Application complète locale** : `app.py`, `transcriber.py`, `web/index.html`. Elle s'exécute sur une machine disposant d'un stockage persistant et de `ffmpeg`. Ses comptes, ses paiements et ses transcriptions n'ont **pas été raccordés à l'hébergement Vercel**.
- **Aperçu UX public sur Vercel** : `web/preview-index.html` (copié comme `index.html`), `web/app.js`, `web/preview.js`, CSS, favicon et **fichiers de partition de démonstration**. Il n'exécute aucune IA, ne reçoit aucun fichier audio ou mot de passe, et ne permet aucun paiement. Un bandeau visible indique toujours les limites.

Cette distinction évite de déployer une base SQLite locale et des tâches longues sur des fonctions serverless sans persistance.

## Reproduire le déploiement statique

1. Créer un nouveau projet Vercel (`Framework Preset: Other`).
2. Publier `web/preview-index.html` comme `index.html` dans la racine servie.
3. Copier `web/styles.css`, `web/app.js`, `web/preview.js`, `web/favicon.svg`, `web/demo/*` sous `/static/...`.
4. Placer `vercel.json` à la racine du projet Vercel.
5. Vérifier `/`, `/app`, `/legal` et les trois téléchargements démo.

## Brancher ultérieurement un dépôt GitHub

Créer un repository public vide, importer ces fichiers, puis dans Vercel : Project Settings → Git → Connect Git Repository. Prévoir un processus de build qui copie les fichiers avec la structure ci-dessus. Ne pas activer la publication du backend FastAPI tant que la base et le stockage persistant ne sont pas provisionnés.

## Avant le passage en production

- Authentification, SQL managé et stockage des exports (RLS / permissions / sauvegardes).
- Queue et workers pour la transcription, ffmpeg, limites de ressources.
- Intégration Stripe en mode test avec webhooks validés, puis tarifs validés.
- Sources audio autorisées et droits applicables.
- RGPD, mentions légales, TVA, protection contre les abus.