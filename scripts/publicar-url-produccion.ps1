param(
  [Parameter(Mandatory = $true)]
  [string]$AppUrl,

  [string]$ClientId = "8c06c1772b384c7173ae092a5da9fad3"
)

$ErrorActionPreference = "Stop"

function Normalize-Url([string]$url) {
  $clean = $url.Trim()
  if ($clean.EndsWith("/")) {
    $clean = $clean.TrimEnd("/")
  }
  return $clean
}

$root = Split-Path -Parent $PSScriptRoot
$tomlPath = Join-Path $root "shopify.app.toml"

if (-not (Test-Path $tomlPath)) {
  throw "No se encontro shopify.app.toml en $root"
}

$baseUrl = Normalize-Url $AppUrl

if (-not ($baseUrl -match "^https://")) {
  throw "La URL debe empezar por https://"
}

$redirects = @(
  "$baseUrl/auth/callback",
  "$baseUrl/auth/shopify/callback",
  "$baseUrl/api/auth/callback"
)

$redirectLine = 'redirect_urls = [ "' + ($redirects -join '", "') + '" ]'

$content = Get-Content -Path $tomlPath -Raw
$content = [regex]::Replace(
  $content,
  '(?m)^application_url\s*=\s*".*"\s*$',
  'application_url = "' + $baseUrl + '"'
)
$content = [regex]::Replace(
  $content,
  '(?m)^redirect_urls\s*=\s*\[.*\]\s*$',
  $redirectLine
)

Set-Content -Path $tomlPath -Value $content -NoNewline

Push-Location $root
try {
  Write-Host "Publicando configuracion con URL: $baseUrl"
  cmd /c "shopify app deploy --client-id $ClientId --allow-updates --no-build --no-color"
}
finally {
  Pop-Location
}

Write-Host "Listo. Shopify app config publicada para produccion."
