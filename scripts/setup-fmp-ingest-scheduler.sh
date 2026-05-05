#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0634831802}"
REGION="${REGION:-asia-southeast1}"
API_ORIGIN="${API_ORIGIN:-https://research-canvas-api-jxycyus54a-as.a.run.app}"
TIME_ZONE="${TIME_ZONE:-Asia/Singapore}"
OPENCLAW_SECRET_NAME="${OPENCLAW_SECRET_NAME:-openclaw-api-key}"

if ! gcloud services list \
  --project="${PROJECT_ID}" \
  --enabled \
  --filter="config.name=cloudscheduler.googleapis.com" \
  --format="value(config.name)" | grep -q '^cloudscheduler.googleapis.com$'; then
  echo "Cloud Scheduler API is not enabled for ${PROJECT_ID}." >&2
  echo "Enable it first: gcloud services enable cloudscheduler.googleapis.com --project=${PROJECT_ID}" >&2
  exit 1
fi

OPENCLAW_API_KEY="${OPENCLAW_API_KEY:-$(gcloud secrets versions access latest --secret="${OPENCLAW_SECRET_NAME}" --project="${PROJECT_ID}")}"
if [[ -z "${OPENCLAW_API_KEY}" ]]; then
  echo "OPENCLAW_API_KEY is empty; cannot create authenticated scheduler jobs." >&2
  exit 1
fi

upsert_job() {
  local name="$1"
  local schedule="$2"
  local body="$3"
  local uri="${API_ORIGIN%/}/api/portfolio/fmp-ingest/run"
  local headers="Authorization=Bearer ${OPENCLAW_API_KEY},Content-Type=application/json"

  if gcloud scheduler jobs describe "${name}" --project="${PROJECT_ID}" --location="${REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --headers="${headers}" \
      --message-body="${body}"
  else
    gcloud scheduler jobs create http "${name}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --headers="${headers}" \
      --message-body="${body}"
  fi
}

upsert_job "research-canvas-fmp-portfolio-news-am" "30 8 * * *" '{"mode":"news"}'
upsert_job "research-canvas-fmp-portfolio-news-pm" "30 20 * * *" '{"mode":"news"}'
upsert_job "research-canvas-fmp-portfolio-transcripts-hourly" "5 * * * *" '{"mode":"transcripts"}'

echo "FMP ingest scheduler jobs are configured in ${PROJECT_ID}/${REGION}."
