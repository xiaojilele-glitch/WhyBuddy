param(
  [string]$BaseRef = "main",
  [bool]$SyncEnv = $true,
  [switch]$OverwriteEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$worktrees = @(
  @{ Branch = "chore/web-aigc-main-control"; Path = "..\whybuddy-web-aigc-0-main-control" },
  @{ Branch = "feat/web-aigc-platform-a"; Path = "..\whybuddy-web-aigc-1-platform-a" },
  @{ Branch = "feat/web-aigc-platform-b"; Path = "..\whybuddy-web-aigc-2-platform-b" },
  @{ Branch = "feat/web-aigc-platform-c"; Path = "..\whybuddy-web-aigc-3-platform-c" },
  @{ Branch = "feat/web-aigc-dialogue-qa"; Path = "..\whybuddy-web-aigc-4-dialogue-qa" },
  @{ Branch = "feat/web-aigc-hitl-session"; Path = "..\whybuddy-web-aigc-5-hitl-session" },
  @{ Branch = "feat/web-aigc-content-processing"; Path = "..\whybuddy-web-aigc-6-content-processing" },
  @{ Branch = "feat/web-aigc-multimodal-output"; Path = "..\whybuddy-web-aigc-7-multimodal-output" },
  @{ Branch = "feat/web-aigc-tools-and-agents"; Path = "..\whybuddy-web-aigc-8-tools-and-agents" },
  @{ Branch = "feat/web-aigc-controlflow"; Path = "..\whybuddy-web-aigc-9-controlflow" },
  @{ Branch = "feat/web-aigc-risk-actions"; Path = "..\whybuddy-web-aigc-10-risk-actions" }
)

Push-Location $repoRoot
try {
  Write-Host "Repository root: $repoRoot"
  Write-Host "Base ref: $BaseRef"
  Write-Host "Preparing Web-AIGC parallel worktrees..."
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
