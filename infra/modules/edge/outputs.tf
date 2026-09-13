output "ip_address" {
  value = google_compute_global_address.api.address
}

output "dns_record" {
  value = {
    type  = "A"
    name  = var.api_domain
    value = google_compute_global_address.api.address
  }
}

output "waf_enforcement_status" {
  value = "rate-limit enforced; OWASP preconfigured rules preview-only pending traffic review"
}

