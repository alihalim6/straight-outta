#!/usr/bin/env python3
"""
Run the playlist refresh locally against your DB and Spotify.
Set env vars (or use a .env file with python-dotenv) before running:

  export DATABASE_URL="postgresql://postgres:postgres@localhost/straight-outta"
  export SPOTIFY_CLIENT_ID="..."
  export SPOTIFY_CLIENT_SECRET="..."

Then: python run_local.py
"""

from __future__ import annotations

import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Ensure we're in the right dir for imports
_script_dir: str = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

import handler

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


class MockContext:
    function_name = "playlist_refresher_local"
    function_version = "0"
    invoked_function_arn = "local"
    memory_limit_in_mb = 128
    aws_request_id = "local"
    log_group_name = "local"
    log_stream_name = "local"


if __name__ == "__main__":
    result: dict[str, object] = handler.lambda_handler({}, MockContext())
    print("Result:", result)
    sys.exit(0 if result.get("statusCode") == 200 else 1)