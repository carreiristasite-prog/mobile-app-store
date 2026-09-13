[CmdletBinding()]
param([switch]$AllowPlaceholders)

$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $siteRoot '../..')).Path
$blockersPath = Join-Path $repoRoot 'docs/compliance/release-blockers.json'
$hashManifestPath = Join-Path $siteRoot 'source-hashes.json'
$permissive = $AllowPlaceholders.IsPresent
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Get-SiteRelativePath {
  param(
    [Parameter(Mandatory=$true)][string]$BasePath,
    [Parameter(Mandatory=$true)][string]$TargetPath
  )

  # [IO.Path]::GetRelativePath exists only on newer .NET runtimes and is not
  # available in Windows PowerShell 5.1, which is still common in CI runners.
  $baseFull = [IO.Path]::GetFullPath($BasePath).TrimEnd([char[]]@('\', '/'))
  $targetFull = [IO.Path]::GetFullPath($TargetPath)
  $prefix = $baseFull + [IO.Path]::DirectorySeparatorChar
  if (-not $targetFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Caminho fora da raiz do site: $targetFull"
  }
  return $targetFull.Substring($prefix.Length)
}

$required = @(
  'index.html', 'privacy/index.html', 'terms/index.html',
  'account-deletion/index.html', 'support/index.html',
  'subprocessors/index.html', 'assets/styles.css',
  'full/terms-of-use.pt-BR.txt', 'full/privacy-policy.pt-BR.txt',
  'source-hashes.json', 'sync-legal-docs.ps1'
)
$sourceMappings = @(
  @{ Id='terms'; Source='docs/legal/terms-of-use.pt-BR.md'; Published='artifacts/legal-site/full/terms-of-use.pt-BR.txt'; Page='terms/index.html'; Href='../full/terms-of-use.pt-BR.txt' },
  @{ Id='privacy'; Source='docs/legal/privacy-policy.pt-BR.md'; Published='artifacts/legal-site/full/privacy-policy.pt-BR.txt'; Page='privacy/index.html'; Href='../full/privacy-policy.pt-BR.txt' }
)

foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $siteRoot $relative))) {
    $errors.Add("Arquivo obrigatorio ausente: $relative")
  }
}

$htmlFiles = @(Get-ChildItem -LiteralPath $siteRoot -Filter '*.html' -Recurse -ErrorAction SilentlyContinue)
$placeholderSet = [System.Collections.Generic.HashSet[string]]::new()
foreach ($file in $htmlFiles) {
  $html = Get-Content -LiteralPath $file.FullName -Raw
  $relative = Get-SiteRelativePath -BasePath $siteRoot -TargetPath $file.FullName
  foreach ($check in @(
    @{ Pattern='(?i)<!doctype html>'; Label='doctype' },
    @{ Pattern='(?i)<html\s+lang="pt-BR"'; Label='lang pt-BR' },
    @{ Pattern='(?i)<meta\s+name="viewport"'; Label='viewport' },
    @{ Pattern='(?i)<title>.+</title>'; Label='title' },
    @{ Pattern='(?i)<main(?:\s|>)'; Label='main landmark' }
  )) {
    if ($html -notmatch $check.Pattern) { $errors.Add("$relative sem $($check.Label)") }
  }
  if ($html -match '(?i)google-analytics|googletagmanager|facebook\.net|segment\.com|mixpanel|hotjar|<script') {
    $errors.Add("$relative contem script/tracker proibido")
  }
  foreach ($match in [regex]::Matches($html, '\{\{[A-Z0-9_]+\}\}')) { [void]$placeholderSet.Add($match.Value) }
  foreach ($match in [regex]::Matches($html, 'href="([^"]+)"')) {
    $href = $match.Groups[1].Value
    if ($href -match '^(https://|mailto:|#)') { continue }
    if ($href -match '^http://') { $errors.Add("$relative usa link HTTP: $href"); continue }
    $target = if ($href.StartsWith('/')) { Join-Path $siteRoot $href.TrimStart('/') } else { Join-Path $file.DirectoryName $href }
    if ($href.EndsWith('/')) { $target = Join-Path $target 'index.html' }
    if (-not (Test-Path -LiteralPath $target)) { $errors.Add("Link local quebrado em $relative`: $href") }
  }
}

$publishedTextFiles = @(Get-ChildItem -LiteralPath (Join-Path $siteRoot 'full') -Filter '*.txt' -ErrorAction SilentlyContinue)
foreach ($file in $publishedTextFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw
  foreach ($match in [regex]::Matches($text, '\{\{[A-Z0-9_]+\}\}')) { [void]$placeholderSet.Add($match.Value) }
}

if ($placeholderSet.Count -gt 0) {
  $message = "Placeholders encontrados: " + (($placeholderSet | Sort-Object) -join ', ')
  if ($permissive) { $warnings.Add($message) } else { $errors.Add($message) }
}

$draftFiles = @($htmlFiles + $publishedTextFiles | Where-Object {
  (Get-Content -LiteralPath $_.FullName -Raw) -match '(?i)\b(draft|minuta|rascunho)\b'
} | ForEach-Object { Get-SiteRelativePath -BasePath $siteRoot -TargetPath $_.FullName })
if ($draftFiles.Count -gt 0) {
  $message = "Conteudo draft/minuta/rascunho encontrado em: " + ($draftFiles -join ', ')
  if ($permissive) { $warnings.Add($message) } else { $errors.Add($message) }
}

$hashManifest = $null
if (Test-Path -LiteralPath $hashManifestPath) {
  try { $hashManifest = Get-Content -LiteralPath $hashManifestPath -Raw | ConvertFrom-Json }
  catch { $errors.Add("Manifesto source-hashes.json invalido: $($_.Exception.Message)") }
}

foreach ($mapping in $sourceMappings) {
  $source = Join-Path $repoRoot $mapping.Source
  $published = Join-Path $repoRoot $mapping.Published
  $page = Join-Path $siteRoot $mapping.Page
  if (-not (Test-Path -LiteralPath $source)) { $errors.Add("Fonte canonica ausente: $($mapping.Source)"); continue }
  if (-not (Test-Path -LiteralPath $published)) { $errors.Add("Texto integral publicado ausente: $($mapping.Published)"); continue }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $publishedHash = (Get-FileHash -LiteralPath $published -Algorithm SHA256).Hash
  if ($sourceHash -ne $publishedHash) {
    $errors.Add("Divergencia de hash em $($mapping.Id): fonte=$sourceHash publicado=$publishedHash")
  }
  $manifestEntry = @($hashManifest.documents | Where-Object { $_.id -eq $mapping.Id })
  if ($manifestEntry.Count -ne 1) {
    $errors.Add("Manifesto de hash precisa de exatamente uma entrada para $($mapping.Id)")
  } elseif ($manifestEntry[0].sha256 -ne $sourceHash -or $manifestEntry[0].source -ne $mapping.Source -or $manifestEntry[0].published -ne $mapping.Published) {
    $errors.Add("Manifesto de hash desatualizado para $($mapping.Id)")
  }
  if (Test-Path -LiteralPath $page) {
    $pageHtml = Get-Content -LiteralPath $page -Raw
    if ($pageHtml -notmatch '(?i)Resumo') { $errors.Add("$($mapping.Page) nao esta rotulada claramente como resumo") }
    $expectedHref = [regex]::Escape(('href="' + $mapping.Href + '"'))
    if ($pageHtml -notmatch $expectedHref) { $errors.Add("$($mapping.Page) nao liga para o texto integral $($mapping.Href)") }
  }
}

$releaseManifest = $null
if (-not (Test-Path -LiteralPath $blockersPath)) {
  $errors.Add('Manifesto docs/compliance/release-blockers.json ausente')
} else {
  try { $releaseManifest = Get-Content -LiteralPath $blockersPath -Raw | ConvertFrom-Json }
  catch { $errors.Add("Manifesto release-blockers.json invalido: $($_.Exception.Message)") }
}
if ($null -ne $releaseManifest) {
  $openRelease = @($releaseManifest.blockers | Where-Object { $_.severity -eq 'release' -and $_.status -eq 'open' })
  if ($permissive) {
    if ($releaseManifest.releaseAllowed -ne $true) { $warnings.Add('releaseAllowed permanece false') }
    if ($openRelease.Count -gt 0) { $warnings.Add("$($openRelease.Count) bloqueios de release permanecem abertos") }
  } else {
    if ($releaseManifest.releaseAllowed -ne $true) { $errors.Add('releaseAllowed precisa ser true') }
    if ($openRelease.Count -gt 0) {
      $ids = ($openRelease | ForEach-Object id) -join ', '
      $errors.Add("$($openRelease.Count) bloqueios de release permanecem abertos: $ids")
    }
  }
}

foreach ($warning in $warnings) { Write-Host "[AVISO] $warning" -ForegroundColor Yellow }
if ($errors.Count -gt 0) {
  foreach ($item in $errors) { Write-Host "[ERRO] $item" -ForegroundColor Red }
  Write-Host "FALHOU: $($errors.Count) erro(s), $($warnings.Count) aviso(s)." -ForegroundColor Red
  exit 1
}
Write-Host "OK: $($htmlFiles.Count) paginas HTML, textos integrais, hashes, links e manifestos validados; $($warnings.Count) aviso(s)."
