output "network_self_link" {
  value = google_compute_network.main.self_link
}

output "vpc_connector_id" {
  value = google_vpc_access_connector.serverless.id
}

output "private_service_range_name" {
  value = google_compute_global_address.private_services.name
}

output "private_service_connection" {
  value = google_service_networking_connection.private_services.peering
}

