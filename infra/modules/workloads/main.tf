resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = var.name_prefix
  description   = "Immutable API and worker images for IA Aprova"
  format        = "DOCKER"
  labels        = var.labels

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s"
    }
  }
}

resource "google_cloud_run_v2_service" "api" {
  count = var.enable_services ? 1 : 0

  project             = var.project_id
  name                = "${var.name_prefix}-api"
  location            = var.region
  description         = "Reviewed IA Aprova HTTP API"
  labels              = var.labels
  deletion_protection = var.deletion_protection
  # Keep the generated run.app URL unreachable from the public internet even
  # while the external edge is not provisioned yet. The LB remains the only
  # intended public entry point.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = var.api_service_account_email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "60s"
    max_instance_request_concurrency = var.api_concurrency

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_connection_name]
      }
    }

    containers {
      name  = "api"
      image = var.api_image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.api_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = lookup(var.secret_versions, env.value, "")
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 2
        period_seconds        = 5
        failure_threshold     = 24
        http_get {
          path = "/api/readyz"
          port = 8080
        }
      }

      # Readiness is a GA Cloud Run feature (2026-06-29) and is supported by
      # the pinned stable hashicorp/google provider. A transient PostgreSQL
      # failure withdraws this instance from traffic without restarting it.
      readiness_probe {
        timeout_seconds   = 2
        period_seconds    = 10
        failure_threshold = 3
        success_threshold = 2
        http_get {
          path = "/api/readyz"
          port = 8080
        }
      }

      # Liveness deliberately excludes PostgreSQL. Dependency failure must not
      # turn into a restart loop; only a stuck/dead HTTP process is restarted.
      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 2
        period_seconds        = 30
        failure_threshold     = 3
        http_get {
          path = "/api/healthz"
          port = 8080
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
      error_message = "api_image must be pinned by sha256 digest."
    }
    precondition {
      condition = alltrue([
        for secret_id in values(var.api_secret_env) :
        can(regex("^[1-9][0-9]*$", lookup(var.secret_versions, secret_id, "")))
      ])
      error_message = "Every API secret must use an explicit enabled numeric version."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  count = var.enable_services ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "worker" {
  count = var.enable_services ? 1 : 0

  project             = var.project_id
  name                = "${var.name_prefix}-worker"
  location            = var.region
  description         = "Reviewed IA Aprova PostgreSQL outbox poller"
  labels              = var.labels
  deletion_protection = var.deletion_protection
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account                  = var.worker_service_account_email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "60s"
    max_instance_request_concurrency = 1

    scaling {
      min_instance_count = var.worker_min_instances
      max_instance_count = var.worker_max_instances
    }

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloud_sql_connection_name]
      }
    }

    containers {
      name  = "worker"
      image = var.worker_image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "1Gi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.worker_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.worker_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = lookup(var.secret_versions, env.value, "")
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 24
        http_get {
          path = "/health/ready"
          port = 8080
        }
      }

      liveness_probe {
        initial_delay_seconds = 10
        timeout_seconds       = 2
        period_seconds        = 30
        failure_threshold     = 3
        http_get {
          path = "/health/live"
          port = 8080
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
      error_message = "worker_image must be pinned by sha256 digest."
    }
    precondition {
      condition = alltrue([
        for secret_id in values(var.worker_secret_env) :
        can(regex("^[1-9][0-9]*$", lookup(var.secret_versions, secret_id, "")))
      ])
      error_message = "Every worker secret must use an explicit enabled numeric version."
    }
  }
}
