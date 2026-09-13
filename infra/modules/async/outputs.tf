output "queue_id" {
  value = google_cloud_tasks_queue.future_http.id
}

output "producer_service_account_email" {
  value = google_service_account.producer.email
}

output "integration_enabled" {
  value = false
}

