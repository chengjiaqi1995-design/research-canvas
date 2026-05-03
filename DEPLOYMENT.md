# Research Canvas Deployment Boundaries

This app intentionally uses two GCP projects in production.

## Production Roles

- App/deploy project: `gen-lang-client-0634831802`
  - Cloud Run frontend: `research-canvas`
  - Cloud Run API: `research-canvas-api`
  - Cloud Build
  - Secret Manager entries consumed by the API
- Data project: `ainotebook-1baa3`
  - Cloud SQL instance: `ainotebook-1baa3:asia-southeast1:ainotebook-db`
  - Live AI Process, feed, and portfolio database records

The frontend should only call the app API:

```text
https://research-canvas-jxycyus54a-as.a.run.app/api
```

The browser should not know which GCP project stores Cloud SQL data. The API owns that routing through Cloud Run environment and Secret Manager configuration.

## Canonical Production URLs

```text
FRONTEND_ORIGIN=https://research-canvas-jxycyus54a-as.a.run.app
API_ORIGIN=https://research-canvas-api-jxycyus54a-as.a.run.app
DATA_CLOUDSQL_INSTANCE=ainotebook-1baa3:asia-southeast1:ainotebook-db
DEPLOY_PROJECT=gen-lang-client-0634831802
DATA_PROJECT=ainotebook-1baa3
```

## Guardrails

`cloudbuild.yaml` refuses production deployment unless:

- `$PROJECT_ID` is `gen-lang-client-0634831802`
- API origin is `https://research-canvas-api-jxycyus54a-as.a.run.app`
- frontend origin is `https://research-canvas-jxycyus54a-as.a.run.app`
- API Cloud SQL target is `ainotebook-1baa3:asia-southeast1:ainotebook-db`

The deploy smoke test checks:

- API health endpoint
- frontend root
- frontend-to-API proxy for EODHD symbol detail
- deployed API Cloud SQL annotation

## Manual Checks

After a production deploy, verify:

```sh
gcloud run services describe research-canvas-api \
  --project=gen-lang-client-0634831802 \
  --region=asia-southeast1 \
  --format=json

npm run smoke:prod
```

The API service annotation `run.googleapis.com/cloudsql-instances` must remain:

```text
ainotebook-1baa3:asia-southeast1:ainotebook-db
```
