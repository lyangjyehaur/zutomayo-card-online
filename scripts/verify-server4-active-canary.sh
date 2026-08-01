#!/usr/bin/env bash

set -euo pipefail

EXPECTED_WEIGHT=''
EXPECTED_STABLE_SLOT=''
EXPECTED_CANDIDATE_SLOT=''
BEST_EFFORT=false
GATEWAY_ACTIVE_STATE="${GATEWAY_ACTIVE_STATE:-gateway-active.json}"
GATEWAY_OBSERVATION_STATE="${GATEWAY_OBSERVATION_STATE:-gateway-observation.json}"
EVIDENCE_DIR="${EVIDENCE_DIR:-evidence}"

die() { printf 'active canary verification failed: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-weight)
      [[ $# -ge 2 ]] || die '--expected-weight requires a value'
      EXPECTED_WEIGHT="$2"
      shift 2
      ;;
    --expected-candidate-slot)
      [[ $# -ge 2 ]] || die '--expected-candidate-slot requires a value'
      EXPECTED_CANDIDATE_SLOT="$2"
      shift 2
      ;;
    --expected-stable-slot)
      [[ $# -ge 2 ]] || die '--expected-stable-slot requires a value'
      EXPECTED_STABLE_SLOT="$2"
      shift 2
      ;;
    --best-effort)
      BEST_EFFORT=true
      shift
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$EXPECTED_WEIGHT" == 0 || "$EXPECTED_WEIGHT" == 10 || "$EXPECTED_WEIGHT" == 50 || "$EXPECTED_WEIGHT" == 100 ]] || {
  die '--expected-weight must be 0, 10, 50, or 100'
}
for slot_option in EXPECTED_STABLE_SLOT EXPECTED_CANDIDATE_SLOT; do
  if [[ -n "${!slot_option}" ]]; then
    [[ "${!slot_option}" == blue || "${!slot_option}" == green ]] || {
      die "--$(printf '%s' "$slot_option" | tr '[:upper:]_' '[:lower:]-') must be blue or green"
    }
  fi
done

[[ -f "$GATEWAY_ACTIVE_STATE" ]] || die 'canonical gateway active state is missing'
expected_phase='rollout'
expected_sequence=$((EXPECTED_WEIGHT == 10 ? 1 : EXPECTED_WEIGHT == 50 ? 2 : EXPECTED_WEIGHT == 100 ? 3 : 4))
if [[ "$EXPECTED_WEIGHT" != 0 ]]; then
  [[ -f "$GATEWAY_OBSERVATION_STATE" ]] || die 'canonical gateway observation state is missing'
else
  expected_phase='rollback'
fi
jq -e \
  --argjson expectedWeight "$EXPECTED_WEIGHT" \
  --argjson expectedSequence "$expected_sequence" \
  --arg expectedPhase "$expected_phase" \
  '.schemaVersion == 1 and .artifactType == "zutomayo-canary-gateway-config" and .deploymentMode == "canary" and .phase == $expectedPhase and .sequence == $expectedSequence and .traffic.candidateWeightPercent == $expectedWeight and .traffic.stableWeightPercent == (100 - $expectedWeight)' \
  "$GATEWAY_ACTIVE_STATE" >/dev/null || die 'active gateway is not the expected canary stage'

active_config_id="$(jq -r '.gateway.activeConfigId // empty' "$GATEWAY_ACTIVE_STATE")"
candidate_release_sha="$(jq -r '.candidateReleaseSha // empty' "$GATEWAY_ACTIVE_STATE")"
stable_slot="$(jq -r '.gateway.stableSlot // empty' "$GATEWAY_ACTIVE_STATE")"
candidate_slot="$(jq -r '.gateway.candidateSlot // empty' "$GATEWAY_ACTIVE_STATE")"
[[ "$candidate_release_sha" =~ ^[a-f0-9]{40}$ ]] || die 'active candidate release SHA is invalid'
[[ "$stable_slot" == blue || "$stable_slot" == green ]] || die 'active stable slot is invalid'
[[ "$candidate_slot" == blue || "$candidate_slot" == green ]] || die 'active candidate slot is invalid'
[[ "$stable_slot" != "$candidate_slot" ]] || die 'active stable and candidate slots must differ'
expected_active_config_id="canary-${candidate_release_sha:0:12}-${EXPECTED_WEIGHT}-${stable_slot}-${candidate_slot}"
[[ "$active_config_id" == "$expected_active_config_id" ]] || {
  die 'active config ID is not bound to the candidate release, weight, and slots'
}
[[ -z "$EXPECTED_STABLE_SLOT" || "$stable_slot" == "$EXPECTED_STABLE_SLOT" ]] || {
  die "active stable slot is $stable_slot, expected $EXPECTED_STABLE_SLOT"
}
[[ -z "$EXPECTED_CANDIDATE_SLOT" || "$candidate_slot" == "$EXPECTED_CANDIDATE_SLOT" ]] || {
  die "active candidate slot is $candidate_slot, expected $EXPECTED_CANDIDATE_SLOT"
}
gateway_ids="$(docker ps -q \
  --filter label=com.docker.compose.project=zutomayo-release-gateway \
  --filter label=com.docker.compose.service=gateway)"
gateway_count="$(printf '%s\n' "$gateway_ids" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "$gateway_count" == 1 ]] || die "expected one running release gateway, found $gateway_count"
runtime_marker="$(docker exec "$gateway_ids" wget -qO- http://127.0.0.1:8404/config 2>/dev/null || true)"
[[ "$runtime_marker" == "$active_config_id" ]] || die 'gateway runtime marker does not match active state'
if [[ "$EXPECTED_WEIGHT" == 0 ]]; then
  printf 'active rollback state verified: stable=%s candidate=%s\n' "$stable_slot" "$candidate_slot"
  exit 0
fi

release_manifest=".release.$candidate_slot.env"
slot_state=".slot.$candidate_slot.state.json"
[[ -f "$release_manifest" ]] || die "candidate release manifest is missing: $release_manifest"
[[ -f "$slot_state" ]] || die "candidate slot state is missing: $slot_state"
manifest_sha256="$(sha256sum "$release_manifest" | awk '{print $1}')"
jq -e \
  --arg slot "$candidate_slot" \
  --arg releaseSha "$candidate_release_sha" \
  --arg manifestSha256 "$manifest_sha256" \
  '.schemaVersion == 1 and .slot == $slot and .releaseSha == $releaseSha and .manifestSha256 == $manifestSha256' \
  "$slot_state" >/dev/null || die 'candidate release manifest is not bound to its verified slot state'
manifest_value() {
  local key="$1"
  local count
  count="$(grep -Ec "^${key}=" "$release_manifest" || true)"
  [[ "$count" == 1 ]] || die "$release_manifest must contain exactly one $key"
  sed -n "s/^${key}=//p" "$release_manifest"
}
manifest_release_sha="$(manifest_value RELEASE_SHA)"
migrate_image="$(manifest_value MIGRATE_IMAGE)"
[[ "$manifest_release_sha" == "$candidate_release_sha" ]] || {
  die 'candidate release manifest SHA does not match the active gateway artifact'
}
[[ "$migrate_image" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] || {
  die 'candidate MIGRATE_IMAGE must be an immutable @sha256 reference'
}
docker image inspect "$migrate_image" >/dev/null || die 'candidate MIGRATE_IMAGE is not present locally'
image_user="$(docker image inspect "$migrate_image" --format '{{.Config.User}}')"
[[ "$image_user" == node ]] || die 'candidate MIGRATE_IMAGE must run as its non-root node user'

jq -e --arg activeConfigId "$active_config_id" \
  '.schemaVersion == 1 and .activeConfigId == $activeConfigId and (.evidencePrefix | type == "string" and length > 0)' \
  "$GATEWAY_OBSERVATION_STATE" >/dev/null || die 'observation state does not match the active gateway config'

evidence_prefix="$(jq -r '.evidencePrefix' "$GATEWAY_OBSERVATION_STATE")"
[[ "$evidence_prefix" =~ ^gateway-[a-f0-9]{12}-(10|50|100)-[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$ ]] || {
  die 'observation evidence prefix is invalid'
}

for suffix in json active-config.txt stats-start.csv applied-at; do
  [[ -s "$EVIDENCE_DIR/$evidence_prefix.$suffix" ]] || die "missing $evidence_prefix.$suffix"
done
active_state_sha256="$(sha256sum "$GATEWAY_ACTIVE_STATE" | awk '{print $1}')"
evidence_sha256="$(sha256sum "$EVIDENCE_DIR/$evidence_prefix.json" | awk '{print $1}')"
[[ "$active_state_sha256" == "$evidence_sha256" ]] || die 'observation gateway artifact does not match active state'
observation_started_at="$(cat "$EVIDENCE_DIR/$evidence_prefix.applied-at")"
jq -e \
  --arg activeConfigId "$active_config_id" \
  --arg evidencePrefix "$evidence_prefix" \
  --arg gatewayConfigSha256 "$evidence_sha256" \
  --arg startedAt "$observation_started_at" \
  --argjson expectedWeight "$EXPECTED_WEIGHT" \
  '.schemaVersion == 1 and .activeConfigId == $activeConfigId and .evidencePrefix == $evidencePrefix and .gatewayConfigSha256 == $gatewayConfigSha256 and .candidateWeightPercent == $expectedWeight and .startedAt == $startedAt' \
  "$GATEWAY_OBSERVATION_STATE" >/dev/null || die 'observation state is not bound to the active artifact and weight'

evidence_root="$(cd "$EVIDENCE_DIR" && pwd -P)"
collector_script="$(pwd -P)/scripts/collect-server4-canary-metrics.mjs"
[[ -f "$collector_script" ]] || die 'installed canary metrics collector is missing'
temp_prefix=".canary-policy.$$.${RANDOM}"
runner_dir="$evidence_root/$temp_prefix"
install -d -m 0700 -o 1000 -g 1000 "$runner_dir"
end_stats="$runner_dir/stats-end.csv"
finished_at="$runner_dir/finished-at"
raw_metrics="$runner_dir/raw-metrics.json"
cleanup() { rm -rf -- "$runner_dir"; }
trap cleanup EXIT

docker exec "$gateway_ids" wget -qO- 'http://127.0.0.1:8405/stats;csv' > "$end_stats"
date -u +%Y-%m-%dT%H:%M:%S.000Z > "$finished_at"
collector_args=(
  --gateway-artifact "/evidence/$evidence_prefix.json"
  --active-marker "/evidence/$evidence_prefix.active-config.txt"
  --start-stats "/evidence/$evidence_prefix.stats-start.csv"
  --end-stats /output/stats-end.csv
  --output /output/raw-metrics.json
)
run_collector() {
  docker run --rm \
    --read-only \
    --network none \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 64 \
    --memory 256m \
    --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
    --volume "$collector_script:/control/collect-server4-canary-metrics.mjs:ro" \
    --volume "$evidence_root:/evidence:ro" \
    --volume "$runner_dir:/output:rw" \
    --entrypoint node \
    "$migrate_image" \
    /control/collect-server4-canary-metrics.mjs \
    "$@"
}
if [[ "$BEST_EFFORT" == true ]]; then
  if ! run_collector "${collector_args[@]}" >/dev/null; then
    mv -f "$end_stats" "$EVIDENCE_DIR/$evidence_prefix.pre-rollback.stats-end.csv"
    mv -f "$finished_at" "$EVIDENCE_DIR/$evidence_prefix.pre-rollback.finished-at"
    printf 'warning: rollback observation saved without raw metrics for %s\n' "$evidence_prefix" >&2
    exit 1
  fi
else
  run_collector \
    "${collector_args[@]}" \
    --enforce-rollout-policy \
    --observation-started-at-file "/evidence/$evidence_prefix.applied-at" \
    --observation-finished-at-file /output/finished-at >/dev/null
fi

if [[ "$BEST_EFFORT" == true ]]; then
  mv -f "$end_stats" "$EVIDENCE_DIR/$evidence_prefix.pre-rollback.stats-end.csv"
  mv -f "$finished_at" "$EVIDENCE_DIR/$evidence_prefix.pre-rollback.finished-at"
  mv -f "$raw_metrics" "$EVIDENCE_DIR/$evidence_prefix.pre-rollback.raw-metrics.json"
else
  mv -f "$end_stats" "$EVIDENCE_DIR/$evidence_prefix.stats-end.csv"
  mv -f "$finished_at" "$EVIDENCE_DIR/$evidence_prefix.finished-at"
  mv -f "$raw_metrics" "$EVIDENCE_DIR/$evidence_prefix.raw-metrics.json"
fi
rmdir "$runner_dir"
trap - EXIT
if [[ "$BEST_EFFORT" == true ]]; then
  printf 'rollback observation captured: weight=%s slot=%s evidence=%s\n' \
    "$EXPECTED_WEIGHT" "$candidate_slot" "$evidence_prefix"
else
  printf 'active canary stage verified: weight=%s slot=%s evidence=%s\n' \
    "$EXPECTED_WEIGHT" "$candidate_slot" "$evidence_prefix"
fi
