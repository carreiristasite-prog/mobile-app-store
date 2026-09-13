variable "project_id" {
  description = "GCP project ID. Use a dedicated project per environment."
  type        = string
}

variable "region" {
  description = "Primary region. This foundation is intentionally constrained to São Paulo."
  type        = string
  default     = "southamerica-east1"

  validation {
    condition     = var.region == "southamerica-east1"
    error_message = "IA Aprova data-plane resources must remain in southamerica-east1."
  }
}

variable "environment" {
  description = "Environment identifier. Production protection is activated only for prod."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "application_name" {
  type    = string
  default = "iaaprova"
}

variable "labels" {
  description = "Additional non-sensitive resource labels."
  type        = map(string)
  default     = {}
}

variable "enable_workloads" {
  description = "Safety gate. Keep false until images exist by digest and all Secret Manager versions are populated."
  type        = bool
  default     = false
}

variable "confirm_api_readiness_probe_staging" {
  description = "Fail-closed production gate. Set true only after startup/readiness/liveness behavior and PostgreSQL loss/recovery were exercised on the same Cloud Run/provider configuration in staging."
  type        = bool
  default     = false
}

variable "confirm_paid_platform_provisioning" {
  description = "Explicit cost acknowledgement required before any plan/apply that provisions the HA data plane, connector and regional services."
  type        = bool
  default     = false
}

variable "enable_external_https_load_balancer" {
  description = "Create the HTTPS load balancer and Cloud Armor edge for the API. Requires enable_workloads and api_domain."
  type        = bool
  default     = false
}

variable "api_domain" {
  description = "Public API DNS name used by the Google-managed certificate."
  type        = string
  default     = ""
}

variable "api_image" {
  description = "Immutable Artifact Registry API image reference, including @sha256 digest."
  type        = string
  default     = ""
}

variable "worker_image" {
  description = "Immutable Artifact Registry worker image reference, including @sha256 digest."
  type        = string
  default     = ""
}

variable "secret_versions" {
  description = "Exact enabled Secret Manager version for every runtime secret ID. Never use latest; version numbers are non-sensitive metadata."
  type        = map(string)
  default     = {}
}

variable "clerk_publishable_key" {
  description = "Clerk publishable key. This is public configuration, not a secret."
  type        = string
  default     = ""
}

variable "cors_allowed_origins" {
  description = "Comma-separated exact web origins. Native mobile requests do not require an Origin header."
  type        = string
  default     = ""
}

variable "identity_policy_version" {
  type    = string
  default = "v1"
}

variable "required_terms_version" {
  type    = string
  default = "REPLACE_AFTER_LEGAL_APPROVAL"
}

variable "required_privacy_notice_version" {
  type    = string
  default = "REPLACE_AFTER_LEGAL_APPROVAL"
}

variable "revenuecat_project_id" {
  description = "RevenueCat project identifier. Not a secret; required by the production worker."
  type        = string
  default     = ""
}

variable "revenuecat_pro_product_id" {
  type    = string
  default = "iaaprova.pro.monthly"
}

variable "confirm_privacy_export_delivery_staging" {
  description = "Set true only after CMEK, customTime lifecycle deletion, soft delete/holds disabled, immediate generation deletion and authenticated download were evidenced in staging."
  type        = bool
  default     = false
}

variable "privacy_retention_policy_id" {
  type    = string
  default = "REPLACE_AFTER_DPO_APPROVAL"
}

variable "privacy_retention_policy_sha256" {
  type    = string
  default = ""
}

variable "privacy_retention_approved_at" {
  type    = string
  default = ""
}

variable "privacy_retention_approved_by" {
  type    = string
  default = ""
}

variable "privacy_retention_rules_json" {
  type    = string
  default = ""
}

variable "api_min_instances" {
  type    = number
  default = 3
}

variable "api_max_instances" {
  type    = number
  default = 100
}

variable "api_concurrency" {
  type    = number
  default = 40
}

variable "worker_min_instances" {
  description = "Fixed warm outbox pollers. Cloud Run request autoscaling does not observe PostgreSQL backlog."
  type        = number
  default     = 2
}

variable "worker_max_instances" {
  type    = number
  default = 10
}

variable "sql_tier" {
  description = "Initial HA Cloud SQL tier for the 80k MAU envelope; confirm with load testing."
  type        = string
  default     = "db-custom-4-15360"
}

variable "sql_disk_size_gb" {
  type    = number
  default = 100
}

variable "redis_memory_size_gb" {
  type    = number
  default = 5
}

variable "notification_channel_ids" {
  description = "Existing Cloud Monitoring notification channel resource IDs."
  type        = list(string)
  default     = []
}

variable "billing_account_id" {
  description = "Billing account ID for budget creation. Empty skips the budget resource."
  type        = string
  default     = ""
}

variable "monthly_budget_brl" {
  description = "Monthly project budget in BRL. This is an alert, never a spending cap."
  type        = number
  default     = 15000
}
