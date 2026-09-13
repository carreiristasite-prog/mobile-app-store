variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "api_service_name" { type = string }
variable "worker_service_name" { type = string }
variable "cloud_sql_instance_name" { type = string }
variable "redis_instance_id" { type = string }
variable "notification_channel_ids" { type = list(string) }

