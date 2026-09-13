[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$infraRoot = Join-Path $repoRoot "infra"
$errors = [System.Collections.Generic.List[string]]::new()
$checks = [System.Collections.Generic.List[string]]::new()

function Resolve-RepoPath([string]$RelativePath) {
  $normalized = $RelativePath -replace '[\\/]', [System.IO.Path]::DirectorySeparatorChar
  return Join-Path $repoRoot $normalized
}

function Require-File([string]$RelativePath) {
  $path = Resolve-RepoPath $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $errors.Add("missing required file: $RelativePath")
    return
  }
  $checks.Add("file: $RelativePath")
}

function Require-Match([string]$RelativePath, [string]$Pattern, [string]$Description) {
  $path = Resolve-RepoPath $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $errors.Add("cannot check missing file: $RelativePath")
    return
  }
  $content = Get-Content -LiteralPath $path -Raw
  if ($content -notmatch $Pattern) {
    $errors.Add("${RelativePath}: missing $Description")
  } else {
    $checks.Add("${RelativePath}: $Description")
  }
}

function Reject-Match([string]$RelativePath, [string]$Pattern, [string]$Description) {
  $path = Resolve-RepoPath $RelativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $errors.Add("cannot check missing file: $RelativePath")
    return
  }
  $content = Get-Content -LiteralPath $path -Raw
  if ($content -match $Pattern) {
    $errors.Add("${RelativePath}: contains forbidden $Description")
  } else {
    $checks.Add("${RelativePath}: no $Description")
  }
}

$requiredFiles = @(
  "infra/backend.tf",
  "infra/main.tf",
  "infra/terraform.tfvars.example",
  "infra/modules/network/main.tf",
  "infra/modules/security/main.tf",
  "infra/modules/data/main.tf",
  "infra/modules/iam/main.tf",
  "infra/modules/async/main.tf",
  "infra/modules/workloads/main.tf",
  "infra/modules/edge/main.tf",
  "infra/modules/observability/main.tf",
  "artifacts/api-server/Dockerfile",
  "artifacts/worker/Dockerfile",
  "docs/operations/api-health-readiness.md",
  "infra/runbooks/restore-pitr.md",
  "infra/runbooks/deploy-rollback.md",
  "infra/runbooks/incident-response.md",
  "infra/runbooks/capacity-test.md",
  "infra/runbooks/privacy-export-delivery.md"
)
$requiredFiles | ForEach-Object { Require-File $_ }

$tfFiles = Get-ChildItem -LiteralPath $infraRoot -Recurse -Filter "*.tf" -File
$allTerraform = ($tfFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"

if ($allTerraform -match 'resource\s+"google_secret_manager_secret_version"') {
  $errors.Add("Terraform must not create Secret Manager versions")
} else {
  $checks.Add("no secret versions in Terraform")
}

if ($allTerraform -match '(?im)^\s*secret_data\s*=') {
  $errors.Add("secret_data must never appear in Terraform")
} else {
  $checks.Add("no secret_data in Terraform")
}

if ($allTerraform -match '(?im)^\s*version\s*=\s*"latest"\s*$') {
  $errors.Add("runtime secrets must use explicit numeric versions, never latest")
} else {
  $checks.Add("no runtime secret references use latest")
}

$openBraces = ([regex]::Matches($allTerraform, '\{')).Count
$closeBraces = ([regex]::Matches($allTerraform, '\}')).Count
if ($openBraces -ne $closeBraces) {
  $errors.Add("Terraform brace count differs: open=$openBraces close=$closeBraces")
} else {
  $checks.Add("Terraform braces balanced (lexical check)")
}

Require-Match "infra/variables.tf" 'variable\s+"enable_workloads"[\s\S]*?default\s*=\s*false' "closed workload gate"
Require-Match "infra/variables.tf" 'variable\s+"confirm_paid_platform_provisioning"[\s\S]*?default\s*=\s*false' "closed paid-platform acknowledgement"
Require-Match "infra/variables.tf" 'variable\s+"confirm_api_readiness_probe_staging"[\s\S]*?default\s*=\s*false' "closed production readiness evidence gate"
Require-Match "infra/variables.tf" 'variable\s+"confirm_privacy_export_delivery_staging"[\s\S]*?default\s*=\s*false' "closed privacy export evidence gate"
Require-Match "infra/main.tf" 'resource\s+"terraform_data"\s+"deployment_gate"[\s\S]*?lifecycle[\s\S]*?precondition' "hard deployment preconditions"
Require-Match "infra/main.tf" '!var\.enable_workloads\s*\|\|\s*var\.environment\s*!=\s*"prod"\s*\|\|\s*var\.confirm_api_readiness_probe_staging' "production readiness staging precondition"
Require-Match "infra/main.tf" '@sha256:\[0-9a-f\]\{64\}' "immutable image digest gate"
Require-Match "infra/main.tf" 'startswith\(var\.api_image,\s*"\$\{local\.image_repository_prefix\}/api@sha256:' "API image restricted to managed repository"
Require-Match "infra/main.tf" 'startswith\(var\.worker_image,\s*"\$\{local\.image_repository_prefix\}/worker@sha256:' "worker image restricted to managed repository"
Require-Match "infra/modules/data/main.tf" 'deletion_protection\s*=\s*var\.deletion_protection' "data deletion protection"
Require-Match "infra/modules/data/main.tf" 'point_in_time_recovery_enabled\s*=\s*true' "Cloud SQL PITR"
Require-Match "infra/modules/data/main.tf" 'ipv4_enabled\s*=\s*false' "private-only Cloud SQL"
Require-Match "infra/modules/data/main.tf" 'transit_encryption_mode\s*=\s*"SERVER_AUTHENTICATION"' "Redis TLS"
Require-Match "infra/modules/data/main.tf" 'resource\s+"google_storage_bucket"\s+"privacy_exports"[\s\S]*?public_access_prevention\s*=\s*"enforced"[\s\S]*?default_event_based_hold\s*=\s*false[\s\S]*?versioning\s*\{\s*enabled\s*=\s*false[\s\S]*?soft_delete_policy\s*\{\s*retention_duration_seconds\s*=\s*0[\s\S]*?days_since_custom_time\s*=\s*0' "private DSR bucket without holds, versioning or soft delete and with customTime lifecycle"
Require-Match "infra/modules/iam/main.tf" 'api_privacy_export_reader[\s\S]*?permissions\s*=\s*\["storage\.objects\.get"\][\s\S]*?api_privacy_export_reader\.id' "API DSR reader cannot list the bucket"
Require-Match "infra/modules/iam/main.tf" 'worker_privacy_export_manager[\s\S]*?storage\.objects\.create[\s\S]*?storage\.objects\.delete[\s\S]*?storage\.objects\.get[\s\S]*?worker_privacy_export_manager\.id' "worker DSR manager has only create delete and get"
Reject-Match "infra/modules/iam/main.tf" 'api_privacy_export_reader[\s\S]{0,300}?roles/storage\.objectViewer|worker_privacy_export_admin[\s\S]{0,300}?roles/storage\.objectAdmin' "broad built-in DSR storage roles"
Require-Match "infra/main.tf" 'confirm_privacy_export_delivery_staging[\s\S]*?privacy_retention_policy_sha256' "hard privacy delivery and retention gate"
Require-Match "infra/main.tf" 'PRIVACY_EXPORT_KMS_KEY_RESOURCE\s*=\s*module\.security\.storage_kms_key_id' "runtime pins the expected DSR CMEK resource"
Require-Match "infra/modules/workloads/main.tf" 'ingress\s*=\s*"INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"' "load-balancer-only API ingress"
Require-Match "infra/versions.tf" 'source\s*=\s*"hashicorp/google"[\s\S]*?version\s*=\s*"= 7\.45\.0"' "exact stable provider with Cloud Run readiness support"
Require-Match "infra/bootstrap/versions.tf" 'source\s*=\s*"hashicorp/google"[\s\S]*?version\s*=\s*"= 7\.45\.0"' "exact bootstrap provider version"
Require-Match "infra/outputs.tf" 'output\s+"realtime_service"[\s\S]*?value\s*=\s*null' "realtime explicitly disabled"
Require-Match "infra/outputs.tf" 'output\s+"admin_service"[\s\S]*?value\s*=\s*null' "admin explicitly disabled"
Require-Match "infra/modules/async/outputs.tf" 'output\s+"integration_enabled"[\s\S]*?value\s*=\s*false' "Cloud Tasks integration explicitly disabled"
Require-Match "infra/modules/observability/main.tf" 'display_name\s*=\s*"API availability 99\.9%' "99.9 percent availability SLO"
Require-Match "infra/modules/observability/main.tf" 'display_name\s*=\s*"95% of API requests below 300ms' "p95 300ms SLO"
Require-Match "infra/modules/observability/main.tf" 'display_name\s*=\s*"99% of API requests below 800ms' "p99 800ms SLO"

$workloads = Get-Content -LiteralPath (Resolve-RepoPath "infra/modules/workloads/main.tf") -Raw
if ($workloads -match 'INGRESS_TRAFFIC_ALL') {
  $errors.Add("API workload must never allow direct public Cloud Run ingress")
} else {
  $checks.Add("no direct public Cloud Run ingress")
}

if ($allTerraform -match '(?m)^\s*(?:provider\s*=\s*google-beta|launch_stage\s*=)') {
  $errors.Add("Cloud Run readiness is GA; beta provider or launch_stage must not be introduced")
} else {
  $checks.Add("Cloud Run readiness uses the stable GA provider surface")
}

Require-Match "infra/modules/workloads/main.tf" 'startup_probe\s*\{[\s\S]*?period_seconds\s*=\s*5[\s\S]*?failure_threshold\s*=\s*24[\s\S]*?http_get\s*\{[\s\S]*?path\s*=\s*"/api/readyz"' "API startup gated by readyz for up to 120 seconds"
Require-Match "infra/modules/workloads/main.tf" 'readiness_probe\s*\{[\s\S]*?period_seconds\s*=\s*10[\s\S]*?failure_threshold\s*=\s*3[\s\S]*?success_threshold\s*=\s*2[\s\S]*?http_get\s*\{[\s\S]*?path\s*=\s*"/api/readyz"' "continuous API readiness withdrawal and recovery"
Require-Match "infra/modules/workloads/main.tf" 'liveness_probe\s*\{[\s\S]*?http_get\s*\{[\s\S]*?path\s*=\s*"/api/healthz"' "API liveness independent from PostgreSQL"
Require-Match "infra/main.tf" 'API_READINESS_TIMEOUT_MS\s*=\s*"1000"' "API readiness timeout shorter than Cloud Run probe timeout"
Require-Match "docs/operations/api-health-readiness.md" 'readiness do Cloud Run está GA desde 29/06/2026' "operations guide records readiness GA status"
Require-Match "docs/operations/api-health-readiness.md" '`confirm_api_readiness_probe_staging` é `false` por padrão' "operations guide records fail-closed evidence gate"

$readinessProbeCount = ([regex]::Matches($workloads, '(?m)^\s*readiness_probe\s*\{')).Count
if ($readinessProbeCount -ne 1) {
  $errors.Add("expected exactly one readiness_probe (API only), found $readinessProbeCount")
} else {
  $checks.Add("worker is unaffected: exactly one readiness_probe exists on the API")
}

$expectedProbePaths = @{
  '"/api/readyz"'   = 2
  '"/api/healthz"'  = 1
  '"/health/ready"' = 1
  '"/health/live"'  = 1
}
foreach ($entry in $expectedProbePaths.GetEnumerator()) {
  $actual = ([regex]::Matches($workloads, [regex]::Escape($entry.Key))).Count
  if ($actual -ne $entry.Value) {
    $errors.Add("unexpected probe path count for $($entry.Key): expected $($entry.Value), found $actual")
  } else {
    $checks.Add("probe path count $($entry.Key)=$actual")
  }
}

foreach ($dockerfile in @("artifacts/api-server/Dockerfile", "artifacts/worker/Dockerfile")) {
  Require-Match $dockerfile '(?m)^ARG\s+NODE_IMAGE\s*$' "required externally pinned Node base image"
  Require-Match $dockerfile 'FROM\s+\$\{NODE_IMAGE\}\s+AS\s+toolchain' "digest-injected multi-stage base"
  Require-Match $dockerfile 'major!==22\|\|minor<13' "Node 22.13+ build assertion"
  Require-Match $dockerfile '(?m)^USER\s+node\s*$' "non-root runtime"
  Require-Match $dockerfile '(?m)^HEALTHCHECK\s+' "container health check"
}
Require-Match "artifacts/api-server/Dockerfile" '/api/healthz' "API health endpoint"
Require-Match "artifacts/worker/Dockerfile" '/health/live' "worker health endpoint"
Require-Match ".dockerignore" '(?m)^infra$' "Terraform excluded from Docker context"
Require-Match ".dockerignore" '(?m)^\*\*/\*\.tfstate\.\*$' "nested Terraform state excluded from Docker context"

$tfvars = Get-Content -LiteralPath (Join-Path $infraRoot "terraform.tfvars.example") -Raw
$suspicious = @(
  '-----BEGIN [A-Z ]+PRIVATE KEY-----',
  'AIza[0-9A-Za-z_-]{30,}',
  'sk_(?!REPLACE)[0-9A-Za-z_-]{16,}',
  'postgres(?:ql)?://[^:\s]+:[^@\s]+@'
)
foreach ($pattern in $suspicious) {
  if ($tfvars -match $pattern) {
    $errors.Add("terraform.tfvars.example appears to contain a credential matching: $pattern")
  }
}
if ($errors.Count -eq 0) {
  $checks.Add("tfvars example contains no recognized credential pattern")
}

if ($errors.Count -gt 0) {
  Write-Host "Static SRE checks failed: $($errors.Count)" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host "  ERR $_" -ForegroundColor Red }
  exit 1
}

Write-Host "Static SRE checks passed: $($checks.Count)" -ForegroundColor Green
$checks | ForEach-Object { Write-Host "  OK  $_" }
Write-Host "LIMITATION: lexical/static checks do not replace terraform validate or Docker builds." -ForegroundColor Yellow
