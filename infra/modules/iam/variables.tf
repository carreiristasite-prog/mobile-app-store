variable "project_id" { type = string }
variable "name_prefix" { type = string }
variable "api_secret_ids" { type = set(string) }
variable "worker_secret_ids" { type = set(string) }
variable "user_content_bucket" { type = string }
variable "grant_api_storage_role" { type = bool }
variable "privacy_exports_bucket" { type = string }
