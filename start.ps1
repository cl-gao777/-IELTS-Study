param([int]$Port = 3000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 22.3 or newer (24 recommended) from https://nodejs.org and run start.bat again.' }
$nodeVersion = ((& node --version).TrimStart('v')).Split('.')
$major = [int]$nodeVersion[0]
$minor = [int]$nodeVersion[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 3)) { throw 'Node.js 22.3 or newer is required; Node.js 24 is recommended.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is missing. Reinstall Node.js with npm.' }
$url = "http://127.0.0.1:$Port"
$health = $null
try { $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2 } catch {}
if ($null -ne $health -and $health.product -eq 'IELTS Studio') {
 $expectedRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([char[]]'\/')
 $runningRoot = [string]$health.instanceRoot
 if ([string]::IsNullOrWhiteSpace($runningRoot)) {
  throw "Port $Port is used by an older IELTS Studio instance whose data location cannot be verified. Stop that server, or run .\start.ps1 -Port 3001."
 }
 try { $runningRoot = [System.IO.Path]::GetFullPath($runningRoot).TrimEnd([char[]]'\/') } catch { throw "The service on port $Port returned an invalid instance path. Stop it, or run .\start.ps1 -Port 3001." }
 if (-not [string]::Equals($runningRoot, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Port $Port is used by IELTS Studio from another folder: $runningRoot. This folder is $expectedRoot. Stop the other server, or run .\start.ps1 -Port 3001."
 }
 Write-Host "IELTS Studio is already running from this folder: $url"
 if (-not $NoBrowser) { Start-Process $url }
 exit 0
}
$env:NEXT_TELEMETRY_DISABLED = '1'
$lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
$stamp = 'node_modules/.studio-lock-hash'
$needInstall = (-not (Test-Path -LiteralPath 'node_modules/next/package.json')) -or (-not (Test-Path -LiteralPath $stamp))
if ((Test-Path -LiteralPath $stamp) -and ((Get-Content -LiteralPath $stamp -Raw).Trim() -ne $lockHash)) { $needInstall = $true }
if ($needInstall) { Write-Host 'Installing locked dependencies (first launch / changed lockfile)...'; & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed. Check your network and retry.' } }
& node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();"
if ($LASTEXITCODE -ne 0) { Write-Host 'Repairing SQLite native module...'; & npm.cmd rebuild better-sqlite3; if ($LASTEXITCODE -ne 0) { throw 'SQLite build failed. Use current Node.js LTS, or install Windows C++ Build Tools.' } }
Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ascii
$needsBuild = $needInstall -or (-not (Test-Path -LiteralPath '.next/BUILD_ID'))
if (-not $needsBuild) {
 $builtAt = (Get-Item -LiteralPath '.next/BUILD_ID').LastWriteTimeUtc
 $sources = @(Get-ChildItem -LiteralPath src -Recurse -File) + @(Get-Item -LiteralPath package.json,package-lock.json,next.config.ts)
 $needsBuild = @($sources | Where-Object { $_.LastWriteTimeUtc -gt $builtAt }).Count -gt 0
}
if ($needsBuild) { Write-Host 'Building IELTS Studio...'; & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the error above; your learning data has not been removed.' } }
Write-Host "IELTS Studio: $url"
Write-Host 'Keep this window open. Press Ctrl+C to stop. Data remains in the data directory.'
if (-not $NoBrowser) {
 $helperPath = Join-Path $PSScriptRoot 'scripts/open-when-ready.ps1'
 # Start-Process joins ArgumentList into a command line; explicitly quote path arguments.
 $helperArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Url "{1}" -InstanceRoot "{2}"' -f $helperPath, $url, $PSScriptRoot
 Start-Process -FilePath 'powershell.exe' -ArgumentList $helperArguments -WindowStyle Hidden
}
& node 'node_modules/next/dist/bin/next' start --hostname 127.0.0.1 --port $Port
exit $LASTEXITCODE

