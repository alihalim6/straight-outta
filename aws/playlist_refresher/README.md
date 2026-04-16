# Playlist Refresher Lambda

Creates or refreshes one Spotify playlist per location using artists from Postgres. Uses a **user OAuth token** (e.g. from PKCE) for playlist create/update; the token is passed via the HTTP request.

## HTTP API (recommended)

Invoke the Lambda from an HTTP API (e.g. API Gateway HTTP API). The client must send a user access token:

- **Method**: POST (or GET if you prefer)
- **Header**: `Authorization: Bearer <access_token>` (token from Spotify PKCE / Authorization Code flow with scopes `playlist-modify-public`, `playlist-modify-private`)

If the header is missing or invalid, the Lambda returns `401`. Configure your API to call this Lambda and pass the request through (including headers).

Optional: copy `.env.example` to `.env` in this directory; the dev API’s `POST /api/refresh` merges it with the process environment when running the handler locally.

## Build

From repo root:

```bash
./aws/playlist_refresher/build.sh
```

Output: `aws/playlist_refresher/dist/playlist_refresher.zip`. Upload this as the Lambda function code in AWS.

## Lambda configuration

- **Runtime**: Python 3.14
- **Handler**: `handler.lambda_handler`
- **Environment variables** (set in Lambda console or via IaC):

  | Variable | Description |
  |---------|-------------|
  | `DATABASE_URL` | Postgres connection string (e.g. Heroku Postgres URL) |
  | `SPOTIFY_CLIENT_ID` | Spotify app client ID |
  | `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
  | `PLAYLIST_NAME_SUFFFIX` | e.g. `WAUX 91.7FM: ` |
  | `ARTISTS_PER_QUERY` | Default `25` |
  | `TRACKS_PER_PLAYLIST` | Default `50` |
  | `SPOTIFY_MARKET` | e.g. `US` |

- **Network**: Ensure the Lambda can reach Postgres (e.g. Heroku) and the internet (Spotify APIs). If the function is in a VPC, use a NAT gateway for outbound traffic.
- **Secrets**: Prefer storing `SPOTIFY_CLIENT_SECRET` and `DATABASE_URL` in AWS Secrets Manager and injecting them at runtime or via env.

## Note on Spotify auth

Playlist create/update require a **user-authorized** token (PKCE or Authorization Code with `playlist-modify-public` / `playlist-modify-private`). The Lambda no longer uses client credentials for those calls; it uses the token from the HTTP request. Use the temporary `/refresh` UI to log in with Spotify and call your API with that token.
