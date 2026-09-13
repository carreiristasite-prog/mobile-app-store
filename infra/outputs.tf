output "artifact_registry_repository" {
  value = module.workloads.artifact_registry_repository
}

output "api_service_name" {
  value = module.workloads.api_service_name
}

output "worker_service_name" {
  value = module.workloads.worker_service_name
}

output "load_balancer_ip" {
  value = try(module.edge[0].ip_address, null)
}

output "cloud_sql_connection_name" {
  value = module.data.cloud_sql_connection_name
}

output "redis_host" {
  value     = module.data.redis_host
  sensitive = true
}

output "secret_ids_requiring_manual_versions" {
  description = "Terraform creates containers only. Populate versions out-of-band before enable_workloads=true."
  value       = sort(tolist(local.secret_ids))
}

output "realtime_service" {
  description = "Explicitly disabled: there is no reviewed realtime deployable in this repository."
  value       = null
}

output "admin_service" {
  description = "Explicitly disabled: there is no reviewed admin deployable in this repository."
  value       = null
}

