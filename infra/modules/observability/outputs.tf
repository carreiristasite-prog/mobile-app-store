output "availability_slo_name" {
  value = google_monitoring_slo.api_availability.name
}

output "latency_slo_name" {
  value = google_monitoring_slo.api_latency.name
}

output "latency_p99_slo_name" {
  value = google_monitoring_slo.api_latency_p99.name
}

output "dashboard_id" {
  value = google_monitoring_dashboard.operations.id
}
