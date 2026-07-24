#!/bin/sh

set -eu

: "${APP_VERSION:?APP_VERSION is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${OFFICIAL_RULINGS_TRANSLATIONS_FILE:?OFFICIAL_RULINGS_TRANSLATIONS_FILE is required}"
: "${OFFICIAL_RULE_DOCUMENTS_FILE:?OFFICIAL_RULE_DOCUMENTS_FILE is required}"

for source_file in "$OFFICIAL_RULINGS_TRANSLATIONS_FILE" "$OFFICIAL_RULE_DOCUMENTS_FILE"; do
  case "$source_file" in
    /run/card-data/*) ;;
    *)
      echo "official content source must be inside the read-only /run/card-data mount: $source_file" >&2
      exit 1
      ;;
  esac
  test -f "$source_file" && test -r "$source_file" && test -s "$source_file" || {
    echo "reviewed official content source is missing, unreadable, or empty: $source_file" >&2
    exit 1
  }
done

node --import tsx scripts/release-official-rulings.ts \
  --translations=- \
  --app-version="$APP_VERSION" \
  --build-id="$RELEASE_SHA" \
  < "$OFFICIAL_RULINGS_TRANSLATIONS_FILE"

OFFICIAL_RULE_DOCUMENTS_FILE="$OFFICIAL_RULE_DOCUMENTS_FILE" \
  node --import tsx scripts/release-official-rule-documents.ts
