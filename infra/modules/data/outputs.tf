output "cloud_sql_instance_name" {
  value = google_sql_database_instance.primary.name
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.primary.connection_name
}

output "redis_instance_id" {
  value = google_redis_instance.cache.name
}

output "redis_host" {
  value     = google_redis_instance.cache.host
  sensitive = true
}

output "user_content_bucket" {
  value = google_storage_bucket.user_content.name
}

output "ops_exports_bucket" {
  value = google_storage_bucket.ops_exports.name
}

output "privacy_exports_bucket" {
  value = google_storage_bucket.privacy_exports.name
}
