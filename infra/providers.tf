provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = local.labels
}

data "google_project" "current" {
  project_id = var.project_id
}

