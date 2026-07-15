#!/usr/bin/env bash
# Resolve a release commit to immutable, signed GHCR image references.
# This script is intentionally fail-closed and is used by CD before deployment.

set -euo pipefail

usage() {
  echo "Usage: $0 <release-sha> <expected-migration> <expected-checksum> [output-file]" >&2
  exit 2
}

[[ $# -ge 3 && $# -le 4 ]] || usage
RELEASE_SHA="$1"
EXPECTED_SCHEMA_MIGRATION="$2"
EXPECTED_SCHEMA_CHECKSUM="$3"
OUTPUT_FILE="${4:-.release.env}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_PREFIX="${IMAGE_PREFIX:-lyangjyehaur/zutomayo-card-online}"
GH_REPOSITORY="${GH_REPOSITORY:-${GITHUB_REPOSITORY:-}}"
COSIGN_IDENTITY_REGEXP="${COSIGN_IDENTITY_REGEXP:-https://github.com/${GH_REPOSITORY}/.github/workflows/cd\\.yml@refs/(heads/master|tags/v[0-9]+\\.[0-9]+\\.[0-9]+([.-][0-9A-Za-z.-]+)?)$}"
COSIGN_OIDC_ISSUER="${COSIGN_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

[[ "$RELEASE_SHA" =~ ^[[:xdigit:]]{40}$ ]] || {
  echo "release SHA must be a full 40-character commit SHA" >&2
  exit 2
}
[[ "$EXPECTED_SCHEMA_MIGRATION" =~ ^[0-9]{6,}_[a-z0-9_]+$ ]] || {
  echo "expected migration must be a migration basename" >&2
  exit 2
}
[[ "$EXPECTED_SCHEMA_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || {
  echo "expected schema checksum must be a 64-character SHA-256 hex digest" >&2
  exit 2
}
MIGRATION_FILE="${MIGRATIONS_DIR:-migrations}/${EXPECTED_SCHEMA_MIGRATION}.js"
[[ -f "$MIGRATION_FILE" ]] || {
  echo "expected migration file not found: $MIGRATION_FILE" >&2
  exit 2
}
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SCHEMA_CHECKSUM="$(sha256sum "$MIGRATION_FILE" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SCHEMA_CHECKSUM="$(shasum -a 256 "$MIGRATION_FILE" | awk '{print $1}')"
else
  echo 'sha256sum or shasum is required' >&2
  exit 127
fi
[[ "$ACTUAL_SCHEMA_CHECKSUM" == "$EXPECTED_SCHEMA_CHECKSUM" ]] || {
  echo "schema checksum does not match $MIGRATION_FILE" >&2
  exit 2
}
[[ -n "$GH_REPOSITORY" ]] || {
  echo 'GH_REPOSITORY or GITHUB_REPOSITORY is required for attestation verification' >&2
  exit 2
}

for command in node docker cosign gh; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "required command not found: $command" >&2
    exit 127
  }
done

APP_VERSION="$(node -p "require('./package.json').version")"
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo 'package.json version is not a release-safe semantic version' >&2
  exit 2
}

resolve_digest() {
  local ref="$1" digest
  digest="$(docker buildx imagetools inspect --format '{{json .Manifest.Digest}}' "$ref" 2>/dev/null | tr -d '"' | head -n 1 || true)"
  if [[ ! "$digest" =~ ^sha256:[[:xdigit:]]{64}$ ]]; then
    digest="$(docker buildx imagetools inspect "$ref" 2>/dev/null | awk '/Digest:/ { print $2; exit }' || true)"
  fi
  [[ "$digest" =~ ^sha256:[[:xdigit:]]{64}$ ]] || {
    echo "unable to resolve immutable digest for $ref" >&2
    exit 1
  }
  printf '%s' "$digest"
}

verify_image() {
  local image="$1" digest="$2" ref="${image}@${digest}"
  cosign verify \
    --certificate-identity-regexp "$COSIGN_IDENTITY_REGEXP" \
    --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" \
    "$ref" >/dev/null
  gh attestation verify "oci://${ref}" --repo "$GH_REPOSITORY" >/dev/null
}

mkdir -p "$(dirname "$OUTPUT_FILE")"
tmp_file="$(mktemp "${OUTPUT_FILE}.tmp.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT

{
  printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
  printf 'APP_VERSION=%s\n' "$APP_VERSION"
  printf 'GAME_RULES_VERSION=%s\n' "$APP_VERSION"
  printf 'EXPECTED_SCHEMA_MIGRATION=%s\n' "$EXPECTED_SCHEMA_MIGRATION"
  printf 'EXPECTED_SCHEMA_CHECKSUM=%s\n' "$EXPECTED_SCHEMA_CHECKSUM"
  for app in game api platform migrate retention; do
    image="${REGISTRY}/${IMAGE_PREFIX}-${app}"
    tag_ref="${image}:${RELEASE_SHA}"
    digest="$(resolve_digest "$tag_ref")"
    verify_image "$image" "$digest"
    key="$(printf '%s' "$app" | tr '[:lower:]-' '[:upper:]_')_IMAGE"
    printf '%s=%s@%s\n' "$key" "$image" "$digest"
  done
} >"$tmp_file"

mv "$tmp_file" "$OUTPUT_FILE"
trap - EXIT
echo "release manifest written: $OUTPUT_FILE"
