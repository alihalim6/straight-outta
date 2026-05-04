# Local Playlist Refresher

Creates or refreshes one Spotify playlist per location using artists from Postgres.

## Setup

From repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/playlist_refresher/requirements.txt
cp backend/playlist_refresher/.env.example backend/playlist_refresher/.env
```

`POST /api/refresh` in `server/api.js` executes `backend/playlist_refresher/handler.py` and merges:

- repo root `.env` (if present)
- `backend/playlist_refresher/.env` (if present)
- current process environment variables

The request must include:

- `Authorization: Bearer <spotify-user-access-token>`
- Optional `region_id` query param or JSON body field
