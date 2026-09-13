locals {
  name_prefix             = "${var.application_name}-${var.environment}"
  is_prod                 = var.environment == "prod"
  image_repository_prefix = "${var.region}-docker.pkg.dev/${var.project_id}/${local.name_prefix}"

  labels = merge({
    application = var.application_name
    environment = var.environment
    managed_by  = "terraform"
    region      = replace(var.region, "-", "_")
  }, var.labels)

  required_services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "vpcaccess.googleapis.com",
  ])

  secret_ids = toset([
    "${local.name_prefix}-database-url",
    "${local.name_prefix}-clerk-secret-key",
    "${local.name_prefix}-guardian-invite-secret",
    "${local.name_prefix}-revenuecat-webhook-signing-secret",
    "${local.name_prefix}-revenuecat-webhook-authorization",
    "${local.name_prefix}-revenuecat-secret-api-key",
  ])

  api_secret_env = {
    DATABASE_URL                      = "${local.name_prefix}-database-url"
    CLERK_SECRET_KEY                  = "${local.name_prefix}-clerk-secret-key"
    GUARDIAN_INVITE_SECRET            = "${local.name_prefix}-guardian-invite-secret"
    REVENUECAT_WEBHOOK_SIGNING_SECRET = "${local.name_prefix}-revenuecat-webhook-signing-secret"
    REVENUECAT_WEBHOOK_AUTHORIZATION  = "${local.name_prefix}-revenuecat-webhook-authorization"
  }

  worker_secret_env = {
    DATABASE_URL              = "${local.name_prefix}-database-url"
    REVENUECAT_SECRET_API_KEY = "${local.name_prefix}-revenuecat-secret-api-key"
    CLERK_SECRET_KEY          = "${local.name_prefix}-clerk-secret-key"
  }

  secret_versions_valid = (
    toset(keys(var.secret_versions)) == local.secret_ids &&
    alltrue([
      for version in values(var.secret_versions) :
      can(regex("^[1-9][0-9]*$", version))
    ])
  )
}
