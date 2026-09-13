resource "google_cloud_tasks_queue" "future_http" {
  project  = var.project_id
  location = var.region
  name     = "${var.name_prefix}-http"

  rate_limits {
    max_dispatches_per_second = 100
    max_concurrent_dispatches = 200
  }

  retry_config {
    max_attempts       = 10
    max_retry_duration = "3600s"
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 5
  }

  stackdriver_logging_config {
    sampling_ratio = 0.1
  }
}

resource "google_service_account" "producer" {
  project      = var.project_id
  account_id   = substr(replace("${var.name_prefix}-tasks", "_", "-"), 0, 30)
  display_name = "IA Aprova Cloud Tasks producer"
  description  = "Reserved keyless identity; no application impersonation is granted yet."
}

resource "google_cloud_tasks_queue_iam_member" "producer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.future_http.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.producer.email}"
}

# The API currently writes a transactional PostgreSQL outbox and the reviewed
# worker polls it. No Cloud Tasks producer or HTTP handler exists in code, so
# Terraform intentionally configures no target, invoker binding, or runtime
# impersonation. Creating the queue is capacity reservation, not integration.

