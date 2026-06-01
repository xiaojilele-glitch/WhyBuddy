param(
  [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$rootEnvPath = Join-Path $repoRoot ".env"

if (-not (Test-Path $rootEnvPath)) {
  throw "Root .env not found at $rootEnvPath"
}

$targets = @(
  "..\whybuddy-0-mission-contracts",
  "..\whybuddy-A-mission-core",
  "..\whybuddy-B-lobster-executor",
  "..\whybuddy-C-brain-dispatch",
  "..\whybuddy-D-feishu-mission-bridge",
  "..\whybuddy-E-tasks-universe",
  "..\whybuddy-F-mission-integration"
)

Push-Location $repoRoot
try {
  foreach ($target in $targets) {
    $resolvedTarget = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $target))
    if (-not (Test-Path $resolvedTarget)) {
      Write-Host "Skipping missing worktree: $resolvedTarget"
      continue
    }

    $targetEnvPath = Join-Path $resolvedTarget ".env"
    if ((Test-Path $targetEnvPath) -and -not $Overwrite) {
      Write-Host "Keeping existing .env in $resolvedTarget"
      continue
    }

    Copy-Item -LiteralPath $rootEnvPath -Destination $targetEnvPath -Force
    Write-Host "Synced .env -> $targetEnvPath"
  }
} finally {
  Pop-Location
}
