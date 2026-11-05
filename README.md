# SongToSheet.ai

AI-assisted sheet music transcription SaaS — V1.

**Public online preview**: an interactive, static UX demo (landing page, simulated studio, credits, preview score and downloadable demo score). The public preview does **not** process audio, charge cards, create real accounts, or provide live AI transcription. These production integrations are deliberately disabled for safe testing.

The full working local backend prototype (FastAPI, experimental monophonic melody transcription, SQLite, Stripe webhook integration and tests) is available in the original V1 bundle while the hosted architecture is being completed.

## Live demo

This repository is connected to Vercel. Vercel serves `index.html` from the main branch and automatically redeploys after pushes.

## Product direction

1. Paste a song link, or upload audio from an authorized source.
2. Select an instrument and create a score.
3. Buy credits before processing; charge only on successful generation.
4. Export PDF, MIDI and MusicXML.

Spotify / YouTube audio cannot be downloaded and transcribed without the relevant rights and platform permissions.

## Deployment

Plain static site; framework preset: **Other**. No build command is required.

## Safety

No API keys are committed, and this public preview does not handle user uploads or payments. Add a persistent database, secure auth, isolated transcription worker and configured Stripe checkout/webhooks before a real launch.
