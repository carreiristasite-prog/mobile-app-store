output "artifact_registry_repository" {
  value = google_artifact_registry_repository.containers.name
}

output "api_service_name" {
  value = var.enable_services ? google_cloud_run_v2_service.api[0].name : null
}

output "worker_service_name" {
  value = var.enable_services ? google_cloud_run_v2_service.worker[0].name : null
}

output "api_uri" {
  value = var.enable_services ? google_cloud_run_v2_service.api[0].uri : null
}

output "worker_uri" {
  value     = var.enable_services ? google_cloud_run_v2_service.worker[0].uri : null
  sensitive = true
}

