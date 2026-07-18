param(
  [string]$Tag = "",
  [string]$OutputDirectory = "output"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Tag) {
  $Tag = (git rev-parse --short HEAD).Trim()
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = Join-Path $repositoryRoot $OutputDirectory
$outputPath = [System.IO.Path]::GetFullPath($outputPath)
$imageName = "ists-linux-release:$Tag"
$archiveName = "ists-linux-standalone-$Tag.tar.gz"
$archivePath = Join-Path $outputPath $archiveName

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

Push-Location $repositoryRoot
try {
  docker build --target runner --tag $imageName .
  if ($LASTEXITCODE -ne 0) {
    throw "Docker build failed."
  }

  if (Test-Path $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  docker run --rm --user root --entrypoint /bin/sh `
    --mount "type=bind,source=$outputPath,target=/out" `
    $imageName `
    -c "tar -czf '/out/$archiveName' -C /app ."
  if ($LASTEXITCODE -ne 0) {
    throw "Linux standalone export failed."
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

