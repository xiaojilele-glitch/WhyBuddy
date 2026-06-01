param(
  [string]$BaseRef = "main",
  [bool]$SyncEnv = $true,
  [switch]$OverwriteEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$worktrees = @(
  @{ Branch = "chore/mission-contracts"; Path = "..\whybuddy-0-mission-contracts" },
  @{ Branch = "feat/mission-core"; Path = "..\whybuddy-A-mission-core" },
  @{ Branch = "feat/lobster-executor"; Path = "..\whybuddy-B-lobster-executor" },
  @{ Branch = "feat/brain-dispatch"; Path = "..\whybuddy-C-brain-dispatch" },
  @{ Branch = "feat/feishu-mission-bridge"; Path = "..\whybuddy-D-feishu-mission-bridge" },
  @{ Branch = "feat/tasks-universe"; Path = "..\whybuddy-E-tasks-universe" },
  @{ Branch = "feat/mission-integration"; Path = "..\whybuddy-F-mission-integration" }
)

Push-Location $repoRoot
try {
  Write-Host "Repository root: $repoRoot"
  Write-Host "Base ref: $BaseRef"
  Write-Host "Reminder: worktrees are created from committed Git history only."

  $rootEnvPath = Join-Path $repoRoot ".env"

  function Sync-EnvToWorktree {
    param(
      [Parameter(Mandatory = $true)]
      [string]$TargetPath
    )

    if (-not $SyncEnv) {
      return
    }

    if (-not (Test-Path $rootEnvPath)) {
      Write-Host "Skipping .env sync because root .env does not exist."
      return
    }

    $targetEnvPath = Join-Path $TargetPath ".env"
    if ((Test-Path $targetEnvPath) -and -not $OverwriteEnv) {
      Write-Host "Keeping existing .env in $TargetPath"
      return
    }

    Copy-Item -LiteralPath $rootEnvPath -Destination $targetEnvPath -Force
    Write-Host "Synced .env -> $targetEnvPath"
  }

  foreach ($item in $worktrees) {
    $branch = $item.Branch
    $path = $item.Path
    $resolvedPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $path))

    git show-ref --verify --quiet "refs/heads/$branch"
    $branchExists = $LASTEXITCODE -eq 0

    if (Test-Path $resolvedPath) {
      Write-Host "Skipping $branch because path already exists: $resolvedPath"
      Sync-EnvToWorktree -TargetPath $resolvedPath
      continue
    }

    if ($branchExists) {
      Write-Host "Creating worktree from existing branch $branch -> $resolvedPath"
      git worktree add $resolvedPath $branch
    } else {
      Write-Host "Creating worktree and branch $branch from $BaseRef -> $resolvedPath"
      git worktree add -b $branch $resolvedPath $BaseRef
    }

    Sync-EnvToWorktree -TargetPath $resolvedPath
  }

  Write-Host ""
  Write-Host "Current worktree list:"
  git worktree list
} finally {
  Pop-Location
}
