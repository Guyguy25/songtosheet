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
