#!/usr/bin/env bash
# Build a zip for AWS Lambda: install deps into a dir, copy our .py files, zip.
# Run from repo root: ./aws/playlist_refresher/build.sh
# Output: aws/playlist_refresher/dist/playlist_refresher.zip

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/dist"
BUILD_DIR="${DIST_DIR}/build"
ZIP_PATH="${DIST_DIR}/playlist_refresher.zip"

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

python3 -m pip install -r "${SCRIPT_DIR}/requirements.txt" -t "${BUILD_DIR}" --quiet
cp "${SCRIPT_DIR}"/config.py "${SCRIPT_DIR}"/db.py "${SCRIPT_DIR}"/handler.py "${SCRIPT_DIR}"/spotify.py "${BUILD_DIR}/"

cd "${BUILD_DIR}"
zip -r "${ZIP_PATH}" . -q
cd - > /dev/null
rm -rf "${BUILD_DIR}"

echo "Built: ${ZIP_PATH}"
