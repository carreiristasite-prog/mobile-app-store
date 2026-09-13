[CmdletBinding()]
param(
  [switch]$BuildContainers,
  [string]$NodeImage = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$infraRoot = Join-Path $repoRoot "infra"

& (Join-Path $PSScriptRoot "static-check.ps1")

$terraform = Get-Command terraform -ErrorAction SilentlyContinue
if ($null -eq $terraform) {
  Write-Error "Terraform is not installed; fmt/init/validate were not executed. Verification remains blocked."
  exit 2
} else {
  & $terraform.Source -chdir=$infraRoot fmt -check -recursive
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $terraform.Source -chdir=$infraRoot init -backend=false
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $terraform.Source -chdir=$infraRoot validate
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($BuildContainers) {
  if ($NodeImage -notmatch '^node:22\.(?:1[3-9]|[2-9][0-9])\.[0-9]+-bookworm-slim@sha256:[0-9a-f]{64}$') {
    throw "-BuildContainers requires -NodeImage pinned to an official Node 22.13+ bookworm-slim sha256 digest."
  }
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $docker) {
    Write-Error "Docker is not installed; requested container builds were not executed. Verification remains blocked."
    exit 2
  } else {
    & $docker.Source build --build-arg "NODE_IMAGE=$NodeImage" -f (Join-Path $repoRoot "artifacts/api-server/Dockerfile") -t iaaprova-api:verify $repoRoot
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $docker.Source build --build-arg "NODE_IMAGE=$NodeImage" -f (Join-Path $repoRoot "artifacts/worker/Dockerfile") -t iaaprova-worker:verify $repoRoot
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}
