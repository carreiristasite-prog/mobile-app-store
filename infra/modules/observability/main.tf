locals {
  api_resource_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.api_service_name}\" AND resource.labels.location=\"${var.region}\""
}

resource "google_monitoring_custom_service" "api" {
  project      = var.project_id
  service_id   = "${var.name_prefix}-api"
  display_name = "IA Aprova API"
}

resource "google_monitoring_slo" "api_availability" {
  project      = var.project_id
  service      = google_monitoring_custom_service.api.service_id
  slo_id       = "availability-999"
  display_name = "API availability 99.9% over 28 days"
  goal         = 0.999

  rolling_period_days = 28

  request_based_sli {
    good_total_ratio {
      good_service_filter  = "metric.type=\"run.googleapis.com/request_count\" AND ${local.api_resource_filter} AND metric.labels.response_code_class!=\"5xx\""
      total_service_filter = "metric.type=\"run.googleapis.com/request_count\" AND ${local.api_resource_filter}"
    }
  }
}

resource "google_monitoring_slo" "api_latency" {
  project      = var.project_id
  service      = google_monitoring_custom_service.api.service_id
  slo_id       = "latency-95-under-300ms"
  display_name = "95% of API requests below 300ms over 28 days"
  goal         = 0.95

  rolling_period_days = 28

  request_based_sli {
    distribution_cut {
      distribution_filter = "metric.type=\"run.googleapis.com/request_latencies\" AND ${local.api_resource_filter}"
      range {
        min = 0
        max = 300
      }
    }
  }
}

resource "google_monitoring_slo" "api_latency_p99" {
  project      = var.project_id
  service      = google_monitoring_custom_service.api.service_id
  slo_id       = "latency-99-under-800ms"
  display_name = "99% of API requests below 800ms over 28 days"
  goal         = 0.99

  rolling_period_days = 28

  request_based_sli {
    distribution_cut {
      distribution_filter = "metric.type=\"run.googleapis.com/request_latencies\" AND ${local.api_resource_filter}"
      range {
        min = 0
        max = 800
      }
    }
  }
}

resource "google_monitoring_alert_policy" "availability_fast_burn" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: API availability fast burn"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "CRITICAL"

  conditions {
    display_name = "1h burn rate above 14.4x"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_availability.name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 14.4
      duration        = "0s"
    }
  }

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Fast API error-budget burn. Follow `infra/runbooks/incident-response.md`; check recent revisions, 5xx logs, Cloud SQL saturation and dependency errors."
  }
}

resource "google_monitoring_alert_policy" "availability_slow_burn" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: API availability slow burn"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "WARNING"

  conditions {
    display_name = "6h burn rate above 6x"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_availability.name}\", \"21600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 6
      duration        = "0s"
    }
  }

  alert_strategy {
    auto_close = "172800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Sustained API error-budget burn. Freeze risky changes and inspect dependency latency and capacity trends."
  }
}

resource "google_logging_metric" "worker_dead_letters" {
  project = var.project_id
  name    = "${var.name_prefix}_worker_dead_letters"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.worker_service_name}\" AND jsonPayload.msg=\"worker_event_dead_lettered\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_logging_metric" "worker_failures" {
  project = var.project_id
  name    = "${var.name_prefix}_worker_failures"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.worker_service_name}\" AND (jsonPayload.msg=\"worker_batch_failed\" OR jsonPayload.msg=\"worker_startup_failed\")"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "worker_dead_letters" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: worker dead letter"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "ERROR"

  conditions {
    display_name = "At least one outbox event dead-lettered"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_dead_letters.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  alert_strategy { auto_close = "86400s" }
  documentation {
    mime_type = "text/markdown"
    content   = "A durable outbox event exhausted retries. Preserve the row, identify the safe errorCode, repair the dependency, then replay idempotently."
  }
}

resource "google_monitoring_alert_policy" "worker_failures" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: worker repeated failures"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "WARNING"

  conditions {
    display_name = "Worker startup or batch failures"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_failures.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  alert_strategy { auto_close = "86400s" }
}

resource "google_monitoring_alert_policy" "sql_cpu" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: Cloud SQL CPU saturation"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "WARNING"

  conditions {
    display_name = "Cloud SQL CPU above 80% for 10m"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${var.cloud_sql_instance_name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  alert_strategy { auto_close = "86400s" }
}

resource "google_monitoring_alert_policy" "redis_memory" {
  project               = var.project_id
  display_name          = "${var.name_prefix}: Redis memory pressure"
  combiner              = "OR"
  notification_channels = var.notification_channel_ids
  severity              = "WARNING"

  conditions {
    display_name = "Redis memory usage above 80% for 10m"
    condition_threshold {
      filter          = "metric.type=\"redis.googleapis.com/stats/memory/usage_ratio\" AND resource.type=\"redis_instance\" AND resource.labels.instance_id=\"${var.redis_instance_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  alert_strategy { auto_close = "86400s" }
}

resource "google_monitoring_dashboard" "operations" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "${var.name_prefix} operations"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "API request rate"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"run.googleapis.com/request_count\" AND ${local.api_resource_filter}"
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM" }
                  }
                }
              }]
              yAxis = { label = "requests/s", scale = "LINEAR" }
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "API p95 latency"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"run.googleapis.com/request_latencies\" AND ${local.api_resource_filter}"
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_PERCENTILE_95", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  }
                }
              }]
              thresholds = [
                { value = 300, color = "YELLOW", direction = "ABOVE" },
                { value = 800, color = "RED", direction = "ABOVE" },
              ]
              yAxis = { label = "ms", scale = "LINEAR" }
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "Cloud SQL CPU"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\" AND resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${var.cloud_sql_instance_name}\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
                  }
                }
              }]
              yAxis = { label = "ratio", scale = "LINEAR" }
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "Worker dead letters"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter      = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.worker_dead_letters.name}\" AND resource.type=\"cloud_run_revision\""
                    aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_SUM", crossSeriesReducer = "REDUCE_SUM" }
                  }
                }
              }]
              yAxis = { label = "events", scale = "LINEAR" }
            }
          }
        }
      ]
    }
  })
}
