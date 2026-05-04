# Straight Outta

Local-first React + Electron app for browsing regional artist pools and refreshing Spotify playlists from your own machine.

## What this project includes

- `src/`: React frontend (Vite)
- `server/api.js`: local Node/Express API
- `backend/playlist_refresher/`: Python refresh job (Spotify + Postgres)
- `electron/main.cjs`: desktop runtime that boots the local API and opens the app

## Requirements

- Node.js `20.19+` (or `22.12+`)
- Python `3.10+`
- Local Postgres database
- Spotify app credentials (for auth + playlist writes)

## First-time setup

1) Install Node dependencies:

```bash
npm install
```

2) Create environment file:

```bash
cp .env.example .env
```

3) Install Python dependencies for the refresher:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/playlist_refresher/requirements.txt
```

For desktop packaging, these dependencies are bundled automatically via:

```bash
npm run prepare:python-deps
```

4) Fill required values in `.env`:

- `VITE_SPOTIFY_CLIENT_ID` (Spotify dashboard -> your app)
- `DATABASE_URL` (defaults to `postgresql://postgres:postgres@localhost/straight-outta`)

## Running the app

- Web dev (API + Vite):

```bash
npm run dev
```

Open `http://127.0.0.1:5173`.

- Desktop dev (API + Vite + Electron):

```bash
npm run dev:desktop
```

- Desktop runtime from built frontend (Electron starts the API automatically):

```bash
npm run desktop
```

## Packaging a clickable macOS app

- ZIP package (recommended default):

```bash
npm run pack:mac
```

Output goes to `release/` (including `Straight Outta-<version>-mac.zip`).
This command also bundles Python refresher dependencies into the app.

- DMG package (optional):

```bash
npm run pack:mac:dmg
```

If DMG fails with missing `libintl.8.dylib`, install gettext first:

```bash
brew install gettext
```

## Notes

- This project is local-first (no AWS deployment path required).
- PWA/service worker support was intentionally removed in favor of Electron desktop UX.
- App branding currently uses `public/logo.jpg` for browser favicon and `assets/logo-icon.png` (1024x1024, white background) for Electron packaging.
- If the desktop app launches without showing a window, check `~/Library/Logs/straight-outta-startup.log` for startup diagnostics.
