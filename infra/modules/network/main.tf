resource "google_compute_network" "main" {
  project                 = var.project_id
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  mtu                     = 1460
}

resource "google_compute_subnetwork" "application" {
  project                  = var.project_id
  name                     = "${var.name_prefix}-application"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.20.0.0/20"
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

resource "google_compute_subnetwork" "serverless_connector" {
  project                  = var.project_id
  name                     = "${var.name_prefix}-serverless"
  region                   = var.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = "10.20.16.0/28"
  private_ip_google_access = true
}

resource "google_vpc_access_connector" "serverless" {
  project       = var.project_id
  name          = "${var.name_prefix}-run"
  region        = var.region
  machine_type  = "e2-standard-4"
  min_instances = 2
  max_instances = 10

  subnet {
    name = google_compute_subnetwork.serverless_connector.name
  }
}

resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "${var.name_prefix}-private-services"
  address_type  = "INTERNAL"
  purpose       = "VPC_PEERING"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# The connector is a Google-managed appliance. These priorities preserve its
# mandatory control traffic while preventing unrelated inbound VPC access.
resource "google_compute_firewall" "connector_health" {
  project   = var.project_id
  name      = "${var.name_prefix}-connector-health"
  network   = google_compute_network.main.name
  direction = "INGRESS"
  priority  = 100

  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  target_tags   = ["vpc-connector"]

  allow {
    protocol = "tcp"
    ports    = ["667"]
  }
}

resource "google_compute_firewall" "connector_serverless" {
  project   = var.project_id
  name      = "${var.name_prefix}-connector-serverless"
  network   = google_compute_network.main.name
  direction = "INGRESS"
  priority  = 100

  source_ranges = ["107.178.230.64/26", "35.199.224.0/19"]
  target_tags   = ["vpc-connector"]

  allow { protocol = "tcp" }
  allow { protocol = "udp" }
  allow { protocol = "icmp" }
}

