output "secret_ids" {
  value = { for key, secret in google_secret_manager_secret.runtime : key => secret.secret_id }
}

output "sql_kms_key_id" {
  value = google_kms_crypto_key.sql.id
}

output "storage_kms_key_id" {
  value = google_kms_crypto_key.storage.id
}

