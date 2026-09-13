resource "google_compute_global_address" "api" {
  project = var.project_id
  name    = "${var.name_prefix}-api"
}

resource "google_compute_managed_ssl_certificate" "api" {
  project = var.project_id
  name    = "${var.name_prefix}-api"

  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_ssl_policy" "api" {
  project         = var.project_id
  name            = "${var.name_prefix}-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_region_network_endpoint_group" "api" {
  project               = var.project_id
  name                  = "${var.name_prefix}-api"
  region                = var.api_region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.api_service_name
  }
}

resource "google_compute_security_policy" "api" {
  project     = var.project_id
  name        = "${var.name_prefix}-api"
  description = "Cloud Armor edge policy. Preconfigured WAF begins in preview for tuning."
  type        = "CLOUD_ARMOR"

  rule {
    action      = "rate_based_ban"
    priority    = 100
    description = "Per-client abuse control; intentionally above expected mobile bursts"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
      ban_duration_sec = 600

      rate_limit_threshold {
        count        = 6000
        interval_sec = 60
      }

      ban_threshold {
        count        = 12000
        interval_sec = 60
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 200
    description = "SQL injection WAF; preview until false-positive review is complete"
    preview     = true
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 2})"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 210
    description = "Cross-site scripting WAF; preview until false-positive review is complete"
    preview     = true
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 2})"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 220
    description = "Local and remote file inclusion WAF in preview"
    preview     = true
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('lfi-v33-stable') || evaluatePreconfiguredWaf('rfi-v33-stable')"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 230
    description = "Remote code execution WAF in preview"
    preview     = true
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('rce-v33-stable')"
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default public API access"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_backend_service" "api" {
  project               = var.project_id
  name                  = "${var.name_prefix}-api"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 60
  security_policy       = google_compute_security_policy.api.id

  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "${var.name_prefix}-https"
  default_service = google_compute_backend_service.api.id
}

resource "google_compute_target_https_proxy" "api" {
  project          = var.project_id
  name             = "${var.name_prefix}-api"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api.id]
  ssl_policy       = google_compute_ssl_policy.api.id
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${var.name_prefix}-https"
  ip_address            = google_compute_global_address.api.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.api.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_url_map" "http_redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-redirect"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "${var.name_prefix}-http"
  ip_address            = google_compute_global_address.api.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

