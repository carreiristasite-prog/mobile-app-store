variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }
variable "network_self_link" { type = string }
variable "private_service_range_name" { type = string }
variable "sql_kms_key_id" { type = string }
variable "storage_kms_key_id" { type = string }
variable "deletion_protection" { type = bool }
variable "sql_tier" { type = string }
variable "sql_disk_size_gb" { type = number }
variable "redis_memory_size_gb" { type = number }

