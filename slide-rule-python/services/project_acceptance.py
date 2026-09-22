"""Managed business acceptance profiles and approved requirement extraction.

This scope is explicit and versioned. Selecting a template alone does not certify
unlisted requirements (for example billing or integrations). A release must name
this profile and carry its independent runtime evidence for the same source.
The fixed task suite remains the executable baseline.  User supplied acceptance
requirements are carried alongside it as an explicit contract so that a later
browser runner can implement them; until such assertions exist they must not
make delivery eligible.
"""

import hashlib

TASK_ACCEPTANCE_PROFILE = "whybuddy-tasks-acceptance@1"
TASK_TEMPLATE_VERSION = "whybuddy-react-vite-tasks-1"


def template_verification_capabilities(template_version):
    suite = {TASK_TEMPLATE_VERSION: "react-vite-tasks@1",
        "whybuddy-react-vite-1": "react-vite-counter@1"}.get(template_version)
    return ["verification:" + suite] if suite else []


TASK_REQUIREMENTS = (
    "Independent application administrator and reader login",
    "Create, edit and filter tasks through a real API",
    "Persist application data across page refresh",
    "Reject writes by readers and unauthenticated users",
    "Build locked source and render without resource or page errors",
)


def normalize_acceptance_requirements(values):
    """Return bounded, de-duplicated user requirements suitable for a contract.

    Requirements are intentionally read only from server-owned goal fields.  A
    client cannot smuggle arbitrary text through ``project_verify`` because the
    control session is the source of truth.
    """
    if not isinstance(values, (list, tuple)):
        return []
    result = []
    seen = set(TASK_REQUIREMENTS)
    for value in values:
        text = str(value or "").strip()
        if not text or len(text) > 1200 or text in seen:
            continue
        seen.add(text)
        result.append(text)
        if len(result) >= 16:
            break
    return result


def approved_acceptance_requirements(state):
    """Extract explicit requirements approved with the current plan.

    The caller must validate plan approval before invoking this helper.
    ``acceptanceRequirements`` is the preferred durable field.  ``requirements``
    and ``acceptanceCriteria`` are accepted for compatibility with older goal
    writers.  Plan prose is deliberately not parsed: free-form prose is not an
    executable assertion and must never silently become delivery evidence.
    """
    goal = getattr(state, "goal", None)
    goal = goal if isinstance(goal, dict) else {}
    for key in ("acceptanceRequirements", "requirements", "acceptanceCriteria"):
        values = normalize_acceptance_requirements(goal.get(key))
        if values:
            return values
    return []


def acceptance_profile(additional_requirements=None):
    extras = normalize_acceptance_requirements(additional_requirements)
    profile_id = TASK_ACCEPTANCE_PROFILE
    if extras:
        digest = hashlib.sha256("\n".join(extras).encode("utf-8")).hexdigest()[:16]
        profile_id = f"{TASK_ACCEPTANCE_PROFILE}+{digest}"
    return {"profileId": profile_id, "suiteVersion": "react-vite-tasks@1",
        "requirements": list(TASK_REQUIREMENTS) + extras,
        "outsideScope": ["Additional user requirements", "Production deployment", "Production account operations"],
        "dataRecovery": "Last durable checkpoint; normal stop checkpoints after stopping the application"}
