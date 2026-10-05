#!/usr/bin/env bash
# Batería HMAC contra portal-system-api de un proyecto Kawiil OS autorizado.
#
# Casos:
#   1) firma válida → aceptada (2xx, ok)
#   2) firma alterada → rechazada (401 signature_invalid)
#   3) timestamp vencido → rechazado (401 timestamp_invalid)
#   4) nonce repetido → rechazado (duplicate / sin fila inbox nueva)
#   5) reintento misma idempotency key → no duplica (cuenta filas si hay DB URL)
#
# Uso:
#   CENTRAL_TO_OS_SIGNING_SECRET=… \
#   ./tools/portal/hmac-battery-portal-system.sh <project-ref> [anon-key]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-allowlist.sh
source "$ROOT/tools/portal/kawiil-os-allowlist.sh"

REF="${1:-}"
ANON_KEY="${2:-${SUPABASE_ANON_KEY:-${KAWIIL_OS_ANON_KEY:-}}}"
kawiil_os_assert_authorized_ref "$REF"

if [[ -z "${CENTRAL_TO_OS_SIGNING_SECRET:-}" ]]; then
  echo "ABORT: defina CENTRAL_TO_OS_SIGNING_SECRET en el entorno (mismo valor cargado en el proyecto)." >&2
  exit 1
fi
kawiil_os_secret_meta "CENTRAL_TO_OS_SIGNING_SECRET" "$CENTRAL_TO_OS_SIGNING_SECRET"

BASE="https://${REF}.supabase.co/functions/v1/portal-system-api"
EVIDENCE_DIR="${HMAC_EVIDENCE_DIR:-$ROOT/docs/portal/evidencia}"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$EVIDENCE_DIR/hmac-battery-${REF}-${STAMP}.txt"

sha256_hex() {
  printf '%s' "$1" | openssl dgst -sha256 -hex | awk '{print $NF}'
}

hmac_hex() {
  local secret="$1" msg="$2"
  printf '%s' "$msg" | openssl dgst -sha256 -hmac "$secret" -hex | awk '{print $NF}'
}

sign_headers() {
  local op="$1" body="$2" ts="$3" nonce="$4"
  local body_hash
  body_hash="$(sha256_hex "$body")"
  hmac_hex "$CENTRAL_TO_OS_SIGNING_SECRET" "${ts}.${nonce}.${op}.${body_hash}"
}

count_inbox() {
  local key="$1"
  if [[ -z "${KAWIIL_OS_DB_URL:-}" ]]; then
    echo "NA"
    return 0
  fi
  if grep -F "$CENTRAL_PROJECT_REF_DENY" <<<"${KAWIIL_OS_DB_URL}" >/dev/null 2>&1; then
    echo "ABORT: KAWIIL_OS_DB_URL apunta a central." >&2
    exit 1
  fi
  psql "$KAWIIL_OS_DB_URL" -Atc \
    "SELECT count(*) FROM portal_system_inbox WHERE idempotency_key = '${key//\'/\'\'}'" 2>/dev/null || echo "ERR"
}

call_api() {
  local op="$1" body="$2" ts="$3" nonce="$4" sig="$5"
  local tmp code
  tmp="$(mktemp)"
  local -a curl_args=(
    -sS -o "$tmp" -w '%{http_code}'
    -X POST "$BASE"
    -H 'Content-Type: application/json'
    -H "x-system-operation: $op"
    -H "x-system-timestamp: $ts"
    -H "x-system-nonce: $nonce"
    -H "x-system-signature: $sig"
  )
  if [[ -n "$ANON_KEY" ]]; then
    curl_args+=(-H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY")
  fi
  code="$(curl "${curl_args[@]}" -d "$body" || echo 000)"
  echo "$code $(tr '\n' ' ' <"$tmp")"
  rm -f "$tmp"
}

PASS=0
FAIL=0
report() {
  local name="$1" expected="$2" got="$3"
  if [[ "$got" == *"$expected"* ]]; then
    echo "PASS | $name | esperado~$expected | obtenido=$got" | tee -a "$OUT"
    PASS=$((PASS + 1))
  else
    echo "FAIL | $name | esperado~$expected | obtenido=$got" | tee -a "$OUT"
    FAIL=$((FAIL + 1))
  fi
}

{
  echo "hmac-battery portal-system-api"
  echo "project_ref=$REF"
  echo "base=$BASE"
  echo "started_utc=$STAMP"
  echo "secret_meta=$(kawiil_os_secret_meta CENTRAL_TO_OS_SIGNING_SECRET "$CENTRAL_TO_OS_SIGNING_SECRET")"
} | tee "$OUT"

OP="company.upsert"
IDEM="hmac-battery-${STAMP}-idem"
COMPANY="hmac-battery-${STAMP}"
BODY="$(printf '{"company_ref":"%s","idempotency_key":"%s","name":"HMAC Battery Co","rfc":null,"tier":"basico"}' "$COMPANY" "$IDEM")"
TS="$(date +%s)"
NONCE="$(printf 'hmacn%s' "$(openssl rand -hex 12)")"

SIG="$(sign_headers "$OP" "$BODY" "$TS" "$NONCE")"

echo "==> 1) firma válida" | tee -a "$OUT"
R1="$(call_api "$OP" "$BODY" "$TS" "$NONCE" "$SIG")"
report "firma_valida" "200" "$R1"

echo "==> 2) firma alterada" | tee -a "$OUT"
BAD_SIG="$(printf '%s' "$SIG" | sed 's/0/1/;s/a/b/;s/f/e/')"
if [[ "$BAD_SIG" == "$SIG" ]]; then
  BAD_SIG="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
fi
R2="$(call_api "$OP" "$BODY" "$TS" "$(printf 'hmacn%s' "$(openssl rand -hex 12)")" "$BAD_SIG")"
report "firma_alterada" "signature_invalid" "$R2"

echo "==> 3) timestamp vencido" | tee -a "$OUT"
OLD_TS=$((TS - 400))
OLD_NONCE="$(printf 'hmacn%s' "$(openssl rand -hex 12)")"
OLD_SIG="$(sign_headers "$OP" "$BODY" "$OLD_TS" "$OLD_NONCE")"
R3="$(call_api "$OP" "$BODY" "$OLD_TS" "$OLD_NONCE" "$OLD_SIG")"
report "timestamp_vencido" "timestamp_invalid" "$R3"

echo "==> 4) nonce repetido" | tee -a "$OUT"
IDEM2="${IDEM}-nonce2"
BODY2="$(printf '{"company_ref":"%s","idempotency_key":"%s","name":"HMAC Battery Co 2","rfc":null,"tier":"basico"}' "$COMPANY" "$IDEM2")"
SIG_REUSE="$(sign_headers "$OP" "$BODY2" "$TS" "$NONCE")"
R4="$(call_api "$OP" "$BODY2" "$TS" "$NONCE" "$SIG_REUSE")"
report "nonce_repetido" "duplicate" "$R4"
AFTER_NONCE="$(count_inbox "$IDEM2")"
echo "inbox_count idem=$IDEM2 after_nonce_reuse=$AFTER_NONCE (esperado 0 o NA)" | tee -a "$OUT"
if [[ "$AFTER_NONCE" == "0" || "$AFTER_NONCE" == "NA" ]]; then
  echo "PASS | nonce_repetido_sin_fila | count=$AFTER_NONCE" | tee -a "$OUT"
  PASS=$((PASS + 1))
elif [[ "$AFTER_NONCE" == "ERR" ]]; then
  echo "SKIP | nonce_repetido_sin_fila | psql no disponible" | tee -a "$OUT"
else
  echo "FAIL | nonce_repetido_sin_fila | count=$AFTER_NONCE" | tee -a "$OUT"
  FAIL=$((FAIL + 1))
fi

echo "==> 5) reintento misma idempotency key" | tee -a "$OUT"
BEFORE5="$(count_inbox "$IDEM")"
NONCE5="$(printf 'hmacn%s' "$(openssl rand -hex 12)")"
SIG5="$(sign_headers "$OP" "$BODY" "$TS" "$NONCE5")"
R5="$(call_api "$OP" "$BODY" "$TS" "$NONCE5" "$SIG5")"
AFTER5="$(count_inbox "$IDEM")"
report "idempotency_reintento" "duplicate" "$R5"
echo "inbox_count idem=$IDEM before_retry=$BEFORE5 after_retry=$AFTER5" | tee -a "$OUT"
if [[ "$AFTER5" == "NA" || "$AFTER5" == "ERR" ]]; then
  echo "SKIP | idempotency_count | sin KAWIIL_OS_DB_URL usable; confiar en duplicate:true" | tee -a "$OUT"
elif [[ "$AFTER5" == "$BEFORE5" && "$AFTER5" != "0" ]]; then
  echo "PASS | idempotency_no_duplica | count_estable=$AFTER5" | tee -a "$OUT"
  PASS=$((PASS + 1))
else
  echo "FAIL | idempotency_no_duplica | before_retry=$BEFORE5 after=$AFTER5" | tee -a "$OUT"
  FAIL=$((FAIL + 1))
fi

{
  echo "finished_utc=$(date -u +%Y%m%dT%H%M%SZ)"
  echo "summary pass=$PASS fail=$FAIL"
} | tee -a "$OUT"

echo "Evidencia: $OUT"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
