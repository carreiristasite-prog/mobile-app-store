output "api_service_account_email" {
  value = google_service_account.api.email
}

output "worker_service_account_email" {
  value = google_service_account.worker.email
}

output "deployer_service_account_email" {
  value = google_service_account.deployer.email
}

