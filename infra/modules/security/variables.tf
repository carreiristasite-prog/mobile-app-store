variable "project_id" { type = string }
variable "project_number" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "secret_ids" { type = set(string) }
variable "labels" { type = map(string) }

