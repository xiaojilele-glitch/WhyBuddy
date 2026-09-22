"""Deployment capability gate shared by HTTP and model-tool composition."""

from config.settings import settings  # Backwards-compatible configuration seam.
from services.project_rollout import allowed_users, rollout_readiness


def project_access_enabled(viewer) -> bool:
    admin = viewer.get("is_superuser", False) if isinstance(viewer, dict) else getattr(viewer, "is_superuser", False)
    identity = viewer.get("id") if isinstance(viewer, dict) else getattr(viewer, "id", None)
    status = rollout_readiness()
    return bool(viewer and status["configured"] and (
        (status["mode"] == "internal" and admin) or
        (status["mode"] == "allowlist" and str(identity) in allowed_users())))


def project_read_access(viewer) -> bool:
    """Rollout rollback keeps owned source/history readable and stoppable."""
    return bool(viewer)
