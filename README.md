# Collabboard

Live at https://collabboard-thoqy5r5ua-uc.a.run.app

## Deployment

The app runs on Google Cloud:

- **Cloud Run** serves the application
- **Cloud SQL** (PostgreSQL 15) for the database
- **Artifact Registry** stores Docker images
- **Terraform** manages all infrastructure (`terraform/`)

Required Terraform variables for auth:
- `clerk_secret_key` (server-side token verification)
- `clerk_publishable_key` (browser Clerk initialization)

## CI/CD

Every push to `master` triggers an automated deploy via **Google Cloud Build**:

1. Builds the Docker image from `Dockerfile`
2. Pushes it to Artifact Registry
3. Deploys the new image to Cloud Run

Build config is in `cloudbuild.yaml`. Build history is visible in the GCP Console under Cloud Build > History.

## Local Development

```
npm install
npm run dev
```

This starts both the client (Vite) and server concurrently.

## LangSmith Tracing

Set these server env vars to trace AI requests and tool-calling runs:

- `LANGSMITH_TRACING=true`
- `LANGSMITH_API_KEY=<your key>`
- `LANGSMITH_PROJECT=collabboard-ai` (or your project name)
- `LANGSMITH_ENDPOINT=https://api.smith.langchain.com` (default hosted endpoint)
- `LANGSMITH_REDACT_PROMPT=true` to hide user prompts in trace inputs
- `LANGSMITH_COLLAPSE_RUNS=false` to emit detailed nested LLM/tool runs via callbacks
