param(
 [Parameter(Mandatory = $true)][string]$Url,
 [Parameter(Mandatory = $true)][string]$InstanceRoot
)

$ErrorActionPreference = 'Stop'
$expectedRoot = [System.IO.Path]::GetFullPath($InstanceRoot).TrimEnd([char[]]'\/')
$watch = [System.Diagnostics.Stopwatch]::StartNew()

while ($watch.Elapsed.TotalSeconds -lt 60) {
 $remaining = 60 - $watch.Elapsed.TotalSeconds
 if ($remaining -lt 1) { break }
 $timeout = [int][Math]::Min(2, [Math]::Floor($remaining))
 try {
  $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec $timeout
  if ($health.product -eq 'IELTS Studio' -and -not [string]::IsNullOrWhiteSpace([string]$health.instanceRoot)) {
   $runningRoot = [System.IO.Path]::GetFullPath([string]$health.instanceRoot).TrimEnd([char[]]'\/')
   if ([string]::Equals($runningRoot, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Start-Process $Url
    exit 0
   }
  }
 } catch {
  # The foreground server may still be starting. Do not open an error page.
 }
 $delay = [int][Math]::Min(500, [Math]::Max(0, (60 - $watch.Elapsed.TotalSeconds) * 1000))
 if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
}

# The startup window already prints the URL for a manual retry after a slow boot.
exit 1
