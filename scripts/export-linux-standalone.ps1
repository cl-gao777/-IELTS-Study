param(
  [string]$Tag = "",
  [string]$OutputDirectory = "output"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Historical entry point; exports a complete npm runtime, not .next/standalone.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required for the optional Linux runtime export. Run start.bat to use the source locally without Docker."
}

if (-not $Tag) {
  $Tag = (git rev-parse --short HEAD).Trim()
}
if ($Tag -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$') {
  throw "Tag must contain only letters, numbers, dots, underscores or hyphens (up to 64 characters)."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = Join-Path $repositoryRoot $OutputDirectory
$outputPath = [System.IO.Path]::GetFullPath($outputPath)
$imageName = "ielts-studio-linux-release:$($Tag.ToLowerInvariant())"
$archiveName = "ielts-studio-linux-runtime-$Tag.tar.gz"
$archivePath = Join-Path $outputPath $archiveName

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

Push-Location $repositoryRoot
try {
  docker build --target runner --tag $imageName .
  if ($LASTEXITCODE -ne 0) {
    throw "Docker build failed."
  }

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  docker run --rm --user root --entrypoint /bin/sh `
    --mount "type=bind,source=$outputPath,target=/out" `
    $imageName `
    -c "tar -czf '/out/$archiveName' -C /app .next node_modules public src/data package.json package-lock.json next.config.ts LICENSE"
  if ($LASTEXITCODE -ne 0) {
    throw "Linux runtime export failed."
  }

  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $size = (Get-Item -LiteralPath $archivePath).Length

  Write-Output "ARCHIVE=$archivePath"
  Write-Output "SIZE=$size"
  Write-Output "SHA256=$hash"
}
finally {
  Pop-Location
}

