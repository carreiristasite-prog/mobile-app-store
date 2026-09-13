terraform {
  # The bucket is created separately by infra/bootstrap. Backend arguments are
  # supplied with -backend-config so project-specific values never live here.
  backend "gcs" {}
}

