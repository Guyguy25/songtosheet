# SongToSheet.ai

**SaaS B2C de transcription musicale — prototype V1.**

## Deux parties complémentaires

- **Démo hébergée sur Vercel** : `index.html`, une landing et un studio interactifs avec crédits et partition d'exemple. Aucun compte, paiement, upload ou traitement IA réel sur cette démo.
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
