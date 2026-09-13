resource "google_sql_database_instance" "primary" {
  project             = var.project_id
  name                = "${var.name_prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  encryption_key_name = var.sql_kms_key_id
  deletion_protection = var.deletion_protection

  settings {
    tier                        = var.sql_tier
    availability_type           = "REGIONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = var.sql_disk_size_gb
    disk_autoresize             = true
    disk_autoresize_limit       = 500
    edition                     = "ENTERPRISE"
    deletion_protection_enabled = var.deletion_protection
    retain_backups_on_delete    = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_self_link
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      location                       = var.region
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 5
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
      query_plans_per_minute  = 5
    }

    password_validation_policy {
      enable_password_policy      = true
      min_length                  = 16
      complexity                  = "COMPLEXITY_DEFAULT"
      reuse_interval              = 10
      disallow_username_substring = true
    }

    user_labels = var.labels
  }

  lifecycle {
    # Cloud SQL can grow this disk outside Terraform. Never plan a destructive
    # shrink back to the original baseline.
    ignore_changes = [settings[0].disk_size]
  }
}

resource "google_sql_database" "application" {
  project  = var.project_id
  name     = "iaaprova"
  instance = google_sql_database_instance.primary.name
  charset  = "UTF8"
}

# No google_sql_user is created here: generating a database password in
# Terraform would persist it in state. The reviewed bootstrap process creates
# the least-privilege login and writes DATABASE_URL directly to Secret Manager.

resource "google_redis_instance" "cache" {
  project                 = var.project_id
  name                    = "${var.name_prefix}-redis"
  region                  = var.region
  tier                    = "STANDARD_HA"
  memory_size_gb          = var.redis_memory_size_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = var.network_self_link
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  reserved_ip_range       = var.private_service_range_name
  location_id             = "${var.region}-a"
  alternative_location_id = "${var.region}-c"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  read_replicas_mode      = "READ_REPLICAS_DISABLED"
  replica_count           = 1
  deletion_protection     = var.deletion_protection
  labels                  = var.labels

  redis_configs = {
    "maxmemory-policy" = "allkeys-lru"
  }

  persistence_config {
    persistence_mode    = "RDB"
    rdb_snapshot_period = "TWELVE_HOURS"
  }

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 5
        minutes = 0
        seconds = 0
        nanos   = 0
      }
    }
  }
}

resource "google_storage_bucket" "user_content" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-user-content"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.labels

  versioning { enabled = true }

  encryption {
    default_kms_key_name = var.storage_kms_key_id
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket" "ops_exports" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-ops-exports"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = var.labels

  versioning { enabled = true }

  encryption {
    default_kms_key_name = var.storage_kms_key_id
  }

  retention_policy {
    retention_period = 2592000
    is_locked        = false
  }

  lifecycle_rule {
    condition {
      age        = 90
      with_state = "ANY"
    }
    action { type = "Delete" }
  }
}

# Dedicated DSR delivery bucket. It deliberately has no retention policy and
# no object versioning: an export must be revocable immediately and must not
# leave an archived generation behind. The worker sets customTime to the exact
# per-export expiry. The custom-time rule is the primary delete control; age is
# a fail-safe upper bound for malformed/missing metadata.
resource "google_storage_bucket" "privacy_exports" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-privacy-exports"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  default_event_based_hold    = false
  force_destroy               = false
  labels                      = var.labels

  versioning { enabled = false }

  # GCS enables a seven-day soft-delete window on new buckets by default.
  # DSR revocation must be permanent for the exact pinned generation, so this
  # dedicated short-lived export bucket opts out explicitly.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  encryption {
    default_kms_key_name = var.storage_kms_key_id
  }

  lifecycle_rule {
    condition {
      days_since_custom_time = 0
      with_state             = "LIVE"
    }
    action { type = "Delete" }
  }

  lifecycle_rule {
    condition {
      age        = 8
      with_state = "LIVE"
    }
    action { type = "Delete" }
  }
}
