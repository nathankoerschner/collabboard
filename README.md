# Collabboard

Live at https://collabboard-thoqy5r5ua-uc.a.run.app

## Deployment

The app runs on Google Cloud:

- **Cloud Run** serves the application
- **Cloud SQL** (PostgreSQL 15) for the database
- **Artifact Registry** stores Docker images
- **Terraform** manages all infrastructure (`terraform/`)

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
