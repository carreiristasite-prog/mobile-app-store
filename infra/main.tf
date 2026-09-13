resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Terraform `check` blocks are diagnostic and do not reliably stop an apply.
# These lifecycle preconditions are the hard, fail-closed deployment barriers.
resource "terraform_data" "platform_gate" {
  input = {
    project_id  = var.project_id
    environment = var.environment
  }

  lifecycle {
    precondition {
      condition     = var.confirm_paid_platform_provisioning
      error_message = "Set confirm_paid_platform_provisioning=true only after reviewing the paid HA platform plan and budget."
    }
  }
}

resource "terraform_data" "deployment_gate" {
  input = {
    enable_workloads               = var.enable_workloads
    enable_edge                    = var.enable_external_https_load_balancer
    readiness_validated_in_staging = var.confirm_api_readiness_probe_staging
  }

  lifecycle {
    precondition {
      condition = !var.enable_workloads || (
        can(regex("@sha256:[0-9a-f]{64}$", var.api_image)) &&
        can(regex("@sha256:[0-9a-f]{64}$", var.worker_image)) &&
        startswith(var.api_image, "${local.image_repository_prefix}/api@sha256:") &&
        startswith(var.worker_image, "${local.image_repository_prefix}/worker@sha256:") &&
        var.clerk_publishable_key != "" &&
        var.revenuecat_project_id != "" &&
        !strcontains(var.required_terms_version, "REPLACE_") &&
        !strcontains(var.required_privacy_notice_version, "REPLACE_") &&
        local.secret_versions_valid
      )
      error_message = "Workloads require immutable image digests, reviewed public/legal configuration and one explicit numeric version for every runtime secret."
    }

    precondition {
      condition     = !var.enable_workloads || var.environment != "prod" || var.enable_external_https_load_balancer
      error_message = "Production workloads require the external HTTPS load balancer and Cloud Armor edge."
    }

    precondition {
      condition     = !var.enable_workloads || var.environment != "prod" || var.confirm_api_readiness_probe_staging
      error_message = "Production workloads require Cloud Run startup/readiness/liveness and PostgreSQL loss/recovery evidence from staging."
    }

    precondition {
      condition = !var.enable_workloads || (
        var.confirm_privacy_export_delivery_staging &&
        !strcontains(var.privacy_retention_policy_id, "REPLACE_") &&
        can(regex("^[a-f0-9]{64}$", var.privacy_retention_policy_sha256)) &&
        var.privacy_retention_approved_at != "" &&
        var.privacy_retention_approved_by != "" &&
        var.privacy_retention_rules_json != ""
      )
      error_message = "Workloads require staging evidence for private DSR export lifecycle/download and externally approved retention metadata."
    }

    precondition {
      condition = !var.enable_external_https_load_balancer || (
        var.enable_workloads &&
        can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.api_domain))
      )
      error_message = "The HTTPS edge requires enabled workloads and a valid api_domain."
    }

    precondition {
      condition     = !var.enable_workloads || var.environment != "prod" || length(var.notification_channel_ids) > 0
      error_message = "Production workloads require at least one tested Monitoring notification channel."
    }

    precondition {
      condition     = !var.enable_workloads || var.environment != "prod" || var.billing_account_id != ""
      error_message = "Production workloads require billing_account_id so the budget alerts are created."
    }
  }
}

module "network" {
  source = "./modules/network"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix

  depends_on = [google_project_service.required, terraform_data.platform_gate]
}

module "security" {
  source = "./modules/security"

  project_id     = var.project_id
  project_number = data.google_project.current.number
  region         = var.region
  name_prefix    = local.name_prefix
  secret_ids     = local.secret_ids
  labels         = local.labels

  depends_on = [google_project_service.required]
}

module "data" {
  source = "./modules/data"

  project_id                 = var.project_id
  region                     = var.region
  name_prefix                = local.name_prefix
  labels                     = local.labels
  network_self_link          = module.network.network_self_link
  private_service_range_name = module.network.private_service_range_name
  sql_kms_key_id             = module.security.sql_kms_key_id
  storage_kms_key_id         = module.security.storage_kms_key_id
  deletion_protection        = local.is_prod
  sql_tier                   = var.sql_tier
  sql_disk_size_gb           = var.sql_disk_size_gb
  redis_memory_size_gb       = var.redis_memory_size_gb

  depends_on = [module.network, module.security]
}

module "iam" {
  source = "./modules/iam"

  project_id             = var.project_id
  name_prefix            = local.name_prefix
  api_secret_ids         = toset(values(local.api_secret_env))
  worker_secret_ids      = toset(values(local.worker_secret_env))
  user_content_bucket    = module.data.user_content_bucket
  grant_api_storage_role = false
  privacy_exports_bucket = module.data.privacy_exports_bucket

  depends_on = [module.security, module.data]
}

module "async" {
  source = "./modules/async"

  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix

  depends_on = [google_project_service.required]
}

module "workloads" {
  source = "./modules/workloads"

  project_id          = var.project_id
  region              = var.region
  name_prefix         = local.name_prefix
  labels              = local.labels
  enable_services     = var.enable_workloads
  deletion_protection = local.is_prod

  api_image                 = var.api_image
  api_service_account_email = module.iam.api_service_account_email
  api_secret_env            = local.api_secret_env
  secret_versions           = var.secret_versions
  api_min_instances         = var.api_min_instances
  api_max_instances         = var.api_max_instances
  api_concurrency           = var.api_concurrency
  api_plain_env = {
    NODE_ENV                           = "production"
    LOG_LEVEL                          = "info"
    CORS_ALLOWED_ORIGINS               = var.cors_allowed_origins
    CLERK_PUBLISHABLE_KEY              = var.clerk_publishable_key
    IDENTITY_POLICY_VERSION            = var.identity_policy_version
    REQUIRED_TERMS_VERSION             = var.required_terms_version
    REQUIRED_PRIVACY_NOTICE_VERSION    = var.required_privacy_notice_version
    GUARDIAN_INVITE_TTL_SECONDS        = "604800"
    REVENUECAT_PRO_PRODUCT_ID          = var.revenuecat_pro_product_id
    API_READINESS_TIMEOUT_MS           = "1000"
    PRIVACY_EXPORT_DELIVERY_ENABLED    = tostring(var.confirm_privacy_export_delivery_staging)
    PRIVACY_EXPORT_BUCKET              = module.data.privacy_exports_bucket
    PRIVACY_EXPORT_BUCKET_ALLOWLIST    = module.data.privacy_exports_bucket
    PRIVACY_EXPORT_OBJECT_PREFIX       = "dsr/exports/"
    PRIVACY_EXPORT_MAX_BYTES           = "52428800"
    PRIVACY_EXPORT_MAX_RANGE_BYTES     = "8388608"
    PRIVACY_EXPORT_TIMEOUT_MS          = "10000"
    PRIVACY_EXPORT_CMEK_CONFIRMED      = "true"
    PRIVACY_EXPORT_KMS_KEY_RESOURCE    = module.security.storage_kms_key_id
    PRIVACY_EXPORT_LIFECYCLE_CONFIRMED = tostring(var.confirm_privacy_export_delivery_staging)
  }

  worker_image                 = var.worker_image
  worker_service_account_email = module.iam.worker_service_account_email
  worker_secret_env            = local.worker_secret_env
  worker_min_instances         = var.worker_min_instances
  worker_max_instances         = var.worker_max_instances
  worker_plain_env = {
    NODE_ENV                           = "production"
    WORKER_REQUIRE_REVENUECAT          = "true"
    REVENUECAT_PROJECT_ID              = var.revenuecat_project_id
    REVENUECAT_ENVIRONMENT             = "production"
    WORKER_BATCH_SIZE                  = "20"
    WORKER_POLL_INTERVAL_MS            = "1000"
    WORKER_LEASE_MS                    = "60000"
    WORKER_MAX_ATTEMPTS                = "12"
    WORKER_SHUTDOWN_TIMEOUT_MS         = "30000"
    WORKER_REQUIRE_PRIVACY             = "true"
    PRIVACY_EXPORT_BUCKET              = module.data.privacy_exports_bucket
    PRIVACY_EXPORT_BUCKET_ALLOWLIST    = module.data.privacy_exports_bucket
    PRIVACY_EXPORT_TTL_HOURS           = "168"
    PRIVACY_TIMEOUT_MS                 = "10000"
    PRIVACY_EXPORT_CMEK_CONFIRMED      = "true"
    PRIVACY_EXPORT_KMS_KEY_RESOURCE    = module.security.storage_kms_key_id
    PRIVACY_EXPORT_LIFECYCLE_CONFIRMED = tostring(var.confirm_privacy_export_delivery_staging)
    PRIVACY_RETENTION_POLICY_ID        = var.privacy_retention_policy_id
    PRIVACY_RETENTION_POLICY_SHA256    = var.privacy_retention_policy_sha256
    PRIVACY_RETENTION_APPROVED_AT      = var.privacy_retention_approved_at
    PRIVACY_RETENTION_APPROVED_BY      = var.privacy_retention_approved_by
    PRIVACY_RETENTION_RULES_JSON       = var.privacy_retention_rules_json
  }

  cloud_sql_connection_name = module.data.cloud_sql_connection_name
  vpc_connector_id          = module.network.vpc_connector_id

  depends_on = [module.iam, module.data, terraform_data.deployment_gate]
}

module "edge" {
  count  = var.enable_external_https_load_balancer && var.enable_workloads ? 1 : 0
  source = "./modules/edge"

  project_id       = var.project_id
  name_prefix      = local.name_prefix
  api_domain       = var.api_domain
  api_service_name = module.workloads.api_service_name
  api_region       = var.region

  depends_on = [module.workloads, terraform_data.deployment_gate]
}

module "observability" {
  count  = var.enable_workloads ? 1 : 0
  source = "./modules/observability"

  project_id               = var.project_id
  region                   = var.region
  name_prefix              = local.name_prefix
  api_service_name         = module.workloads.api_service_name
  worker_service_name      = module.workloads.worker_service_name
  cloud_sql_instance_name  = module.data.cloud_sql_instance_name
  redis_instance_id        = module.data.redis_instance_id
  notification_channel_ids = var.notification_channel_ids

  depends_on = [module.workloads]
}

resource "google_billing_budget" "monthly" {
  count = var.billing_account_id == "" ? 0 : 1

  billing_account = var.billing_account_id
  display_name    = "${local.name_prefix}-monthly-budget"

  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "BRL"
      units         = tostring(floor(var.monthly_budget_brl))
      nanos         = floor((var.monthly_budget_brl - floor(var.monthly_budget_brl)) * 1000000000)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.8
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = var.notification_channel_ids
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.required]
}

check "workload_prerequisites" {
  assert {
    condition = !var.enable_workloads || (
      can(regex("@sha256:[0-9a-f]{64}$", var.api_image)) &&
      can(regex("@sha256:[0-9a-f]{64}$", var.worker_image)) &&
      var.clerk_publishable_key != "" &&
      var.revenuecat_project_id != "" &&
      !strcontains(var.required_terms_version, "REPLACE_") &&
      !strcontains(var.required_privacy_notice_version, "REPLACE_")
    )
    error_message = "Before enabling workloads, use immutable image digests and set reviewed runtime configuration."
  }
}

check "edge_prerequisites" {
  assert {
    condition = !var.enable_external_https_load_balancer || (
      var.enable_workloads && can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", var.api_domain))
    )
    error_message = "The HTTPS edge requires enabled workloads and a valid api_domain."
  }
}
