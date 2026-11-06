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

## Deux parties complémentaires

- **Démo hébergée sur Vercel** : `index.html`, une landing orientée saisie de lien (sans grille tarifaire), un studio interactif, une fenêtre d'abonnement et une partition d'exemple. Aucun compte, paiement, upload ou traitement IA réel sur cette démo.
- **Application locale** : `backend/` contient l'API FastAPI, les comptes, les crédits, Stripe à configurer, les tests, la transcription expérimentale monophonique et les exports PDF, MIDI, MusicXML.

## Tunnel simulé avant inscription (novembre 2026)

Parcours de la démo Vercel : lien YouTube/Spotify/Deezer/SoundCloud/Apple Music ou fichier audio → simulation animée (~7 s) → « Ta partition est prête » → « Découvrir mes 30 secondes » → `/inscription` → `/apercu` (extrait **illustratif** de 30 secondes) → consultation des offres.

- **Aucune transcription réelle n'est produite à partir d'un lien ou d'un fichier.** L'extrait est une mélodie originale fixe, explicitement indiquée comme démonstration. Le paiement est toujours désactivé.
- Les fichiers audio doivent respecter 25 Mo et 6 minutes au maximum : durée lue localement avec l'API audio du navigateur ; si le format ou la durée ne peuvent pas être vérifiés, le fichier est refusé.
- Les liens sont contrôlés par domaine/HTTPS, **mais leur durée ne peut pas être vérifiée sans intégration serveur aux plateformes**. Il faudra imposer les 6 minutes côté backend avant toute vraie génération et tout paiement.
- L'inscription est simulée avec une adresse email conservée dans le `sessionStorage` de l'onglet ; aucun compte durable ni mot de passe n'est créé.
- `/generation` et `/apercu` sont rechargeables grâce aux rewrites Vercel ; les états de génération restent dans le stockage de session.
- Code de la vue : `assets/conversion-flow.js` et `assets/conversion-flow.css`. Les routes et le CTA sont reliés dans `index.html`.


### Parcours de sélection et métadonnées (novembre 2026)

- Clic sur « Continuer » depuis la landing → lecture des métadonnées publiques via `api/media-info.js` (titre, auteur, miniature et durée **si disponible**) → `/choisir-instrument` → simulation progressive de **18 secondes** → écran prêt → inscription simulée → démonstration musicale de 30 secondes.
- Pour les **fichiers**, vérification de 25 Mo et 6 minutes dès l'import, avec erreur sous le champ sur la landing.
- Pour les **liens**, la durée doit désormais être **effectivement vérifiée** avant de poursuivre : **> 360 secondes : erreur 422**, **durée inconnue : erreur 424 et blocage du tunnel**. Aucun morceau dont la durée n'a pas pu être vérifiée ne peut passer à l'étape de choix de l'instrument. Les fichiers audio restent contrôlés dans le navigateur. YouTube utilise les métadonnées du lecteur pour **l'ID exact** de la vidéo, et peut utiliser l'API officielle si la variable serveur `YOUTUBE_DATA_API_KEY` est configurée. Sans clé et si YouTube bloque la récupération des métadonnées, la vidéo est refusée avec un message explicite. Deezer et Apple Music peuvent fournir les durées ; Spotify et SoundCloud ne les fournissent pas toujours, ce qui bloque temporairement ces liens jusqu'à l'ajout d'une source de métadonnées fiable.
- Les miniatures et titres proviennent de métadonnées publiques, mais l'aperçu reste **une partition illustrative non liée au morceau**, le traitement audio réel n'étant pas activé. Aucun achat ni compte durable n'est créé.

## Déploiement

Ce dépôt est configuré pour un site statique Vercel (racine du repo, preset « Other », sans commande de build). Chaque push sur `main` met à jour la démo après connexion Git.

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

Le site Vercel n'héberge pas encore le moteur de transcription, les comptes ni Stripe. L'analyse monophonique reste expérimentale. Les liens Spotify/YouTube sont acceptés comme références, sans extraction de l'audio ; importer uniquement un contenu autorisé.

Le déploiement commercial demandera une base SQL managée, du stockage persistant, des workers, un traitement sécurisé et la configuration Stripe. Aucune clé privée n'est publiée dans ce dépôt.
