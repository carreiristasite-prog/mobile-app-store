[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $siteRoot '../..')).Path
$mappings = @(
  @{ Id='terms'; Source='docs/legal/terms-of-use.pt-BR.md'; Published='artifacts/legal-site/full/terms-of-use.pt-BR.txt' },
  @{ Id='privacy'; Source='docs/legal/privacy-policy.pt-BR.md'; Published='artifacts/legal-site/full/privacy-policy.pt-BR.txt' }
)

$documents = @()
foreach ($mapping in $mappings) {
  $source = Join-Path $repoRoot $mapping.Source
  $published = Join-Path $repoRoot $mapping.Published
  if (-not (Test-Path -LiteralPath $source)) { throw "Documento canonico ausente: $($mapping.Source)" }
  Copy-Item -LiteralPath $source -Destination $published -Force
  $documents += [ordered]@{
    id = $mapping.Id
    source = $mapping.Source
    published = $mapping.Published
    sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  }
}

$manifest = [ordered]@{ schemaVersion = 1; algorithm = 'SHA256'; documents = $documents }
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $siteRoot 'source-hashes.json') -Encoding utf8
Write-Host "OK: $($documents.Count) textos integrais sincronizados byte a byte."
