param([int]$Port = 3000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 22 or newer from https://nodejs.org and run start.bat again.' }
$major = [int](((& node --version).TrimStart('v')).Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22 or newer is required.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is missing. Reinstall Node.js with npm.' }
$url = "http://127.0.0.1:$Port"
try { $health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2; if ($health.product -eq 'IELTS Studio') { Write-Host "IELTS Studio is already running: $url"; if (-not $NoBrowser) { Start-Process $url }; exit 0 } } catch {}
$env:NEXT_TELEMETRY_DISABLED = '1'
$lockHash = (Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash
$stamp = 'node_modules/.studio-lock-hash'
$needInstall = -not (Test-Path -LiteralPath 'node_modules/next/package.json')
if ((Test-Path -LiteralPath $stamp) -and ((Get-Content -LiteralPath $stamp -Raw).Trim() -ne $lockHash)) { $needInstall = $true }
if ($needInstall) { Write-Host 'Installing locked dependencies (first launch / changed lockfile)...'; & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed. Check your network and retry.' } }
& node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();"
if ($LASTEXITCODE -ne 0) { Write-Host 'Repairing SQLite native module...'; & npm.cmd rebuild better-sqlite3; if ($LASTEXITCODE -ne 0) { throw 'SQLite build failed. Use current Node.js LTS, or install Windows C++ Build Tools.' } }
Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ascii
$needsBuild = -not (Test-Path -LiteralPath '.next/BUILD_ID')
if (-not $needsBuild) {
 $builtAt = (Get-Item -LiteralPath '.next/BUILD_ID').LastWriteTimeUtc
 $sources = @(Get-ChildItem -LiteralPath src -Recurse -File) + @(Get-Item -LiteralPath package.json,package-lock.json,next.config.ts)
 $needsBuild = @($sources | Where-Object { $_.LastWriteTimeUtc -gt $builtAt }).Count -gt 0
}
if ($needsBuild) { Write-Host 'Building IELTS Studio...'; & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the error above; your learning data has not been removed.' } }
Write-Host "IELTS Studio: $url"
Write-Host 'Keep this window open. Press Ctrl+C to stop. Data remains in the data directory.'
if (-not $NoBrowser) { Start-Process $url }
& node 'node_modules/next/dist/bin/next' start --hostname 127.0.0.1 --port $Port
exit $LASTEXITCODE

