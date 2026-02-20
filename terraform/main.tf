terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ---------------------------------------------------------------------------
# Enable required APIs
# ---------------------------------------------------------------------------
locals {
  apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "vpcaccess.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudbuild.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Artifact Registry — Docker repo
# ---------------------------------------------------------------------------
resource "google_artifact_registry_repository" "collabboard" {
  location      = var.region
  repository_id = "collabboard"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# VPC + Serverless VPC Access connector
# ---------------------------------------------------------------------------
resource "google_compute_network" "main" {
  name                    = "collabboard-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name          = "collabboard-subnet"
  network       = google_compute_network.main.id
  ip_cidr_range = "10.0.0.0/24"
  region        = var.region
}

resource "google_compute_global_address" "private_ip" {
  name          = "cloudsql-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]

  depends_on = [google_project_service.apis]
}

resource "google_vpc_access_connector" "connector" {
  name   = "collabboard-vpc-cx"
  region = var.region

  subnet {
    name = google_compute_subnetwork.connector_subnet.name
  }

  min_instances = 2
  max_instances = 3

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "connector_subnet" {
  name          = "collabboard-vpc-cx-subnet"
  network       = google_compute_network.main.id
  ip_cidr_range = "10.8.0.0/28"
  region        = var.region
}

# ---------------------------------------------------------------------------
# Cloud SQL — PostgreSQL 15
# ---------------------------------------------------------------------------
resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "google_sql_database_instance" "postgres" {
  name             = "collabboard-pg"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.main.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled = false
    }
  }

  deletion_protection = false

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "collabboard" {
  name     = "collabboard"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "collabboard" {
  name     = "collabboard"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

# ---------------------------------------------------------------------------
# Secret Manager — DB password + Clerk secret
# ---------------------------------------------------------------------------
resource "google_secret_manager_secret" "db_password" {
  secret_id = "collabboard-db-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

resource "google_secret_manager_secret" "clerk_secret_key" {
  secret_id = "collabboard-clerk-secret-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "clerk_secret_key" {
  secret      = google_secret_manager_secret.clerk_secret_key.id
  secret_data = var.clerk_secret_key
}

resource "google_secret_manager_secret" "openai_api_key" {
  secret_id = "collabboard-openai-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "openai_api_key" {
  secret      = google_secret_manager_secret.openai_api_key.id
  secret_data = var.openai_api_key
}

resource "google_secret_manager_secret" "langsmith_api_key" {
  secret_id = "collabboard-langsmith-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "langsmith_api_key" {
  secret      = google_secret_manager_secret.langsmith_api_key.id
  secret_data = var.langsmith_api_key
}

# ---------------------------------------------------------------------------
# Cloud Run service account + IAM
# ---------------------------------------------------------------------------
resource "google_service_account" "cloud_run" {
  account_id   = "collabboard-run"
  display_name = "Collabboard Cloud Run"
}

resource "google_secret_manager_secret_iam_member" "db_password_access" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "clerk_secret_access" {
  secret_id = google_secret_manager_secret.clerk_secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "openai_api_key_access" {
  secret_id = google_secret_manager_secret.openai_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "langsmith_api_key_access" {
  secret_id = google_secret_manager_secret.langsmith_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ---------------------------------------------------------------------------
# Cloud Run service
# ---------------------------------------------------------------------------
locals {
  image        = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.collabboard.repository_id}/app:latest"
  database_url = "postgresql://${google_sql_user.collabboard.name}:${random_password.db_password.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/${google_sql_database.collabboard.name}"
}

resource "google_cloud_run_v2_service" "collabboard" {
  name     = "collabboard"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    session_affinity = true

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
      }

      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }

      env {
        name  = "DATABASE_SSL"
        value = "false"
      }

      env {
        name = "CLERK_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.clerk_secret_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "CLERK_PUBLISHABLE_KEY"
        value = var.clerk_publishable_key
      }

      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.openai_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LANGSMITH_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.langsmith_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "LANGSMITH_TRACING"
        value = tostring(var.langsmith_tracing)
      }

      env {
        name  = "LANGSMITH_ENDPOINT"
        value = var.langsmith_endpoint
      }

      env {
        name  = "LANGSMITH_PROJECT"
        value = var.langsmith_project
      }

      env {
        name  = "LANGSMITH_REDACT_PROMPT"
        value = tostring(var.langsmith_redact_prompt)
      }

      env {
        name  = "LANGSMITH_COLLAPSE_RUNS"
        value = tostring(var.langsmith_collapse_runs)
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        period_seconds = 30
      }
    }

    timeout = "3600s"
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.clerk_secret_access,
    google_secret_manager_secret_iam_member.db_password_access,
    google_secret_manager_secret_iam_member.openai_api_key_access,
    google_secret_manager_secret_iam_member.langsmith_api_key_access,
  ]
}

# Allow unauthenticated access (public web app)
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.collabboard.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Cloud Build — CI/CD pipeline
# ---------------------------------------------------------------------------
data "google_project" "current" {}

resource "google_service_account" "cloudbuild" {
  account_id   = "collabboard-cloudbuild"
  display_name = "Collabboard Cloud Build"
}

locals {
  cloud_build_sa = "serviceAccount:${google_service_account.cloudbuild.email}"
}

# Cloud Build trigger — runs on push to master
#
# One-time setup: connect GitHub in Cloud Build > Triggers > Connect Repository
#
resource "google_cloudbuild_trigger" "deploy" {
  name = "collabboard-deploy"

  github {
    owner = "nathankoerschner"
    name  = "collabboard"

    push {
      branch = "^master$"
    }
  }

  filename        = "cloudbuild.yaml"
  service_account = google_service_account.cloudbuild.id

  substitutions = {
    _REGION = var.region
  }

  depends_on = [google_project_service.apis]
}

# Cloud Build SA — push images to Artifact Registry
resource "google_artifact_registry_repository_iam_member" "cloudbuild_writer" {
  location   = google_artifact_registry_repository.collabboard.location
  repository = google_artifact_registry_repository.collabboard.repository_id
  role       = "roles/artifactregistry.writer"
  member     = local.cloud_build_sa
}

# Cloud Build SA — deploy to Cloud Run
resource "google_project_iam_member" "cloudbuild_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = local.cloud_build_sa
}

# Cloud Build SA — act as the Cloud Run service account
resource "google_service_account_iam_member" "cloudbuild_act_as" {
  service_account_id = google_service_account.cloud_run.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.cloud_build_sa
}

# Cloud Build SA — write build logs
resource "google_project_iam_member" "cloudbuild_logs_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.cloud_build_sa
}
