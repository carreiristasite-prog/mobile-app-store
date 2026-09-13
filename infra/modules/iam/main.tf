resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = substr(replace("${var.name_prefix}-api", "_", "-"), 0, 30)
  display_name = "IA Aprova API runtime"
  description  = "Keyless runtime identity for the API only."
}

resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = substr(replace("${var.name_prefix}-worker", "_", "-"), 0, 30)
  display_name = "IA Aprova outbox worker runtime"
  description  = "Keyless runtime identity for the reviewed outbox worker only."
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = substr(replace("${var.name_prefix}-deployer", "_", "-"), 0, 30)
  display_name = "IA Aprova Cloud Run deployer"
  description  = "Keyless CI identity; authenticate through Workload Identity Federation."
}

locals {
  runtime_project_roles = toset([
    "roles/cloudsql.client",
    "roles/cloudtrace.agent",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  deployer_project_roles = toset([
    "roles/artifactregistry.writer",
    "roles/run.developer",
    "roles/serviceusage.serviceUsageConsumer",
  ])
}

resource "google_project_iam_member" "api_runtime" {
  for_each = local.runtime_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_runtime" {
  for_each = local.runtime_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "deployer" {
  for_each = local.deployer_project_roles

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_uses_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_uses_worker" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each = var.api_secret_ids

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker" {
  for_each = var.worker_secret_ids

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# Disabled until the API contains a reviewed GCS adapter. Provisioning a bucket
# must not silently grant business-data access to code that does not use it.
resource "google_storage_bucket_iam_member" "api_object_user" {
  count = var.grant_api_storage_role ? 1 : 0

  bucket = var.user_content_bucket
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_custom_role" "api_privacy_export_reader" {
  project     = var.project_id
  role_id     = "iaAprovaDsrApiReader"
  title       = "IA Aprova DSR API Reader"
  description = "Read one generation-addressed private DSR object without listing the bucket."
  permissions = ["storage.objects.get"]
}

resource "google_project_iam_custom_role" "worker_privacy_export_manager" {
  project     = var.project_id
  role_id     = "iaAprovaDsrWorkerManager"
  title       = "IA Aprova DSR Worker Manager"
  description = "Create, verify and permanently delete generation-addressed private DSR objects without listing the bucket."
  permissions = [
    "storage.objects.create",
    "storage.objects.delete",
    "storage.objects.get",
  ]
}

resource "google_storage_bucket_iam_member" "api_privacy_export_reader" {
  bucket = var.privacy_exports_bucket
  role   = google_project_iam_custom_role.api_privacy_export_reader.id
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "worker_privacy_export_admin" {
  bucket = var.privacy_exports_bucket
  role   = google_project_iam_custom_role.worker_privacy_export_manager.id
  member = "serviceAccount:${google_service_account.worker.email}"
}
