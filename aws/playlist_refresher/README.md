# Playlist Refresher Lambda

Creates or refreshes one Spotify playlist per location using artists from Postgres. Intended to run on a schedule (e.g. EventBridge).

## Build

From repo root:

```bash
./aws/playlist_refresher/build.sh
```

Output: `aws/playlist_refresher/dist/playlist_refresher.zip`. Upload this as the Lambda function code in AWS.

## Lambda configuration

- **Runtime**: Python 3.12
- **Handler**: `handler.lambda_handler`
- **Environment variables** (set in Lambda console or via IaC):

  | Variable | Description |
  |---------|-------------|
  | `DATABASE_URL` | Postgres connection string (e.g. Heroku Postgres URL) |
  | `SPOTIFY_CLIENT_ID` | Spotify app client ID |
  | `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
  | `PLAYLIST_NAME_PREFIX` | e.g. `WAUX 91.7FM: ` |
  | `ARTISTS_PER_QUERY` | Default `25` |
  | `TRACKS_PER_PLAYLIST` | Default `50` |
  | `SPOTIFY_MARKET` | e.g. `US` |

- **Network**: Ensure the Lambda can reach Postgres (e.g. Heroku) and the internet (Spotify APIs). If the function is in a VPC, use a NAT gateway for outbound traffic.
- **Secrets**: Prefer storing `SPOTIFY_CLIENT_SECRET` and `DATABASE_URL` in AWS Secrets Manager and injecting them at runtime or via env.

## Schedule (EventBridge)

Create an EventBridge rule to invoke the Lambda on a schedule, for example:

- **Rate**: `rate(1 day)` or `rate(1 hour)`
- **Target**: This Lambda function

## Note on Spotify auth

Playlist create/update require a **user-authorized** token (e.g. Authorization Code flow with `playlist-modify-public`). If you get permission errors with client credentials, switch to storing a user refresh token and obtain an access token from it; then set that token (or refresh flow) in the Lambda (e.g. via a secret or dedicated env).
