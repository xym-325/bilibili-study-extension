$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$utf8 = [System.Text.Encoding]::UTF8
$packageJson = [System.IO.File]::ReadAllText((Join-Path $projectRoot "package.json"), $utf8) | ConvertFrom-Json
$sourceManifest = [System.IO.File]::ReadAllText((Join-Path $projectRoot "manifest.json"), $utf8) | ConvertFrom-Json
$distPath = Join-Path $projectRoot "dist"
$releasePath = Join-Path $projectRoot "release"
$archivePath = Join-Path $releasePath ("bilibili-study-extension-{0}.zip" -f $packageJson.version)

if ($packageJson.version -ne $sourceManifest.version) {
  throw "package.json and manifest.json versions do not match."
}

$builtManifestPath = Join-Path $distPath "manifest.json"
if (-not (Test-Path -LiteralPath $builtManifestPath -PathType Leaf)) {
  throw "dist/manifest.json is missing. Run the build first."
}

$builtManifest = [System.IO.File]::ReadAllText($builtManifestPath, $utf8) | ConvertFrom-Json
if ($builtManifest.version -ne $packageJson.version) {
  throw "dist/manifest.json and package.json versions do not match."
}

New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path (Join-Path $distPath "*") -DestinationPath $archivePath -CompressionLevel Optimal

$archive = Get-Item -LiteralPath $archivePath
Write-Host ("Created {0} ({1:N0} bytes)" -f $archive.FullName, $archive.Length)
