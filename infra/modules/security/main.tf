resource "google_kms_key_ring" "application" {
  project  = var.project_id
  name     = var.name_prefix
  location = var.region
}

resource "google_kms_crypto_key" "secrets" {
  name            = "secret-manager"
  key_ring        = google_kms_key_ring.application.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "sql" {
  name            = "cloud-sql"
  key_ring        = google_kms_key_ring.application.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "storage" {
  name            = "cloud-storage"
  key_ring        = google_kms_key_ring.application.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "secret_manager_agent" {
  crypto_key_id = google_kms_crypto_key.secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${var.project_number}@gcp-sa-secretmanager.iam.gserviceaccount.com"
}

resource "google_kms_crypto_key_iam_member" "cloud_sql_agent" {
  crypto_key_id = google_kms_crypto_key.sql.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${var.project_number}@gcp-sa-cloud-sql.iam.gserviceaccount.com"
}

data "google_storage_project_service_account" "gcs" {
  project = var.project_id
}

resource "google_kms_crypto_key_iam_member" "storage_agent" {
  crypto_key_id = google_kms_crypto_key.storage.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_secret_manager_secret" "runtime" {
  for_each = var.secret_ids

  project   = var.project_id
  secret_id = each.value
  labels    = var.labels

  replication {
    user_managed {
      replicas {
        location = var.region
        customer_managed_encryption {
          kms_key_name = google_kms_crypto_key.secrets.id
        }
      }
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.secret_manager_agent]
}

# Deliberately no google_secret_manager_secret_version resources. Runtime
# values must be injected by an authorized operator/CI and never enter tfvars,
# plan output, or Terraform state.

