#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy.sh [IMAGE_TAG]
# Builds, pushes, and deploys Collabboard to GCP Cloud Run via Terraform.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="${1:-$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)}"

# Read Terraform outputs for registry URL
REPO_URL=$(terraform -chdir="$SCRIPT_DIR/terraform" output -raw artifact_registry_url)
IMAGE="${REPO_URL}/app:${TAG}"

echo "==> Building image: ${IMAGE}"
docker build --platform linux/amd64 -t "${IMAGE}" "$SCRIPT_DIR"

echo "==> Pushing image to Artifact Registry"
docker push "${IMAGE}"

echo "==> Deploying with Terraform (image_tag=${TAG})"
terraform -chdir="$SCRIPT_DIR/terraform" apply -var="image_tag=${TAG}" -auto-approve

echo ""
echo "==> Deployed successfully!"
terraform -chdir="$SCRIPT_DIR/terraform" output cloud_run_url
