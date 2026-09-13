variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "southamerica-east1"
}

variable "state_bucket_name" {
  description = "Globally unique GCS bucket name."
  type        = string
}

variable "terraform_principal" {
  description = "IAM member allowed to read/write state, for example serviceAccount:terraform@project.iam.gserviceaccount.com."
  type        = string
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "bootstrap" {
  for_each = toset([
    "cloudkms.googleapis.com",
    "storage.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

data "google_storage_project_service_account" "gcs" {
  project    = var.project_id
  depends_on = [google_project_service.bootstrap]
}

resource "google_kms_key_ring" "state" {
  name     = "terraform-state"
  location = var.region

  depends_on = [google_project_service.bootstrap]
}

resource "google_kms_crypto_key" "state" {
  name            = "terraform-state"
  key_ring        = google_kms_key_ring.state.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "gcs" {
  crypto_key_id = google_kms_crypto_key.state.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_storage_bucket" "state" {
  name                        = var.state_bucket_name
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.state.id
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 25
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.gcs]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket_iam_member" "state_admin" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = var.terraform_principal
}

output "backend_config" {
  value = {
    bucket = google_storage_bucket.state.name
    prefix = "iaaprova/prod"
  }
}

