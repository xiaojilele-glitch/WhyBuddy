"""Injectable runtime boundary for skill.invoke.

⚠ 2026-08-27：非产品流、流式 driver 不调、禁止接成控制面。
事故：skill_runtime 是独立可注入适配器（测试/node_bridge 才 set），
v5_full_driver 与 rehearsal_control 零引用。若把薄控制面接进来，
会变成不通电的插座——skill.invoke 适配器不是推演母语，也不是
工厂信封。产品流的技能图走 v5_skill_runtime_graph，不走本模块。

This module defines the adapter interface used by the Python SlideRule
executor. It does not discover skills, launch local commands, or call external
services; callers inject an adapter that implements the runtime-specific work.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol

DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE = "python-fake-skill"
DEFAULT_SKILL_RUNTIME = "fake-skill"


class SkillRuntimeUnavailable(Exception):
    """Raised when the injected skill runtime is unavailable."""


class SkillNotFoundError(Exception):
    """Raised when the runtime does not expose the requested skill."""


class SkillInvalidArgumentsError(Exception):
    """Raised when the runtime rejects the supplied skill arguments."""


class SkillInvokeDeniedError(Exception):
    """Raised when policy denies the requested skill invocation."""


class SkillRuntimeError(Exception):
    """Raised when the runtime fails while invoking a skill."""


@dataclass(frozen=True)
class SkillInvokeRequest:
    skill_id: str
    arguments: Dict[str, Any]
    input: str
    runtime: str = DEFAULT_SKILL_RUNTIME


@dataclass(frozen=True)
class SkillInvokeResult:
    output: str
    response: Any = None
    runtime: Optional[str] = None
    provenance: Optional[str] = None


class SkillRuntimeAdapter(Protocol):
    def invoke(self, request: SkillInvokeRequest) -> SkillInvokeResult:
        ...


SkillRegistry = SkillRuntimeAdapter


@dataclass(frozen=True)
class SkillRuntime:
    adapter: SkillRuntimeAdapter
    runtime: str = DEFAULT_SKILL_RUNTIME
    provenance: Optional[str] = None

    @property
    def registry(self) -> SkillRuntimeAdapter:
        return self.adapter

    def provenance_for(self, runtime: Optional[str] = None) -> str:
        if self.provenance:
            return self.provenance
        runtime_name = runtime or self.runtime
        return f"skill-runtime:{runtime_name}"


_skill_runtime: Optional[SkillRuntime] = None


def set_skill_runtime(runtime: Optional[SkillRuntime]) -> None:
    global _skill_runtime
    _skill_runtime = runtime


def get_skill_runtime() -> Optional[SkillRuntime]:
    return _skill_runtime


def create_skill_runtime(
    *,
    adapter: Optional[SkillRuntimeAdapter] = None,
    registry: Optional[SkillRegistry] = None,
    runtime: str = DEFAULT_SKILL_RUNTIME,
    provenance: Optional[str] = None,
) -> SkillRuntime:
    selected_adapter = adapter or registry
    if selected_adapter is None:
        raise ValueError("skill runtime requires an adapter")

    selected_provenance = provenance
    if selected_provenance is None and adapter is None and registry is not None:
        selected_provenance = DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE

    return SkillRuntime(
        adapter=selected_adapter,
        runtime=runtime,
        provenance=selected_provenance,
    )


DM_RBAC_POLICY_IMPACT_EVIDENCE = "DM_RBAC_POLICY_IMPACT_EVIDENCE"
DM_PAGE_BINDING_IMPACT_EVIDENCE = "DM_PAGE_BINDING_IMPACT_EVIDENCE"
DM_WORKFLOW_BINDING_IMPACT_EVIDENCE = "DM_WORKFLOW_BINDING_IMPACT_EVIDENCE"


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return sorted(item for item in value if isinstance(item, str))


def create_datamodel_rbac_policy_impact_evidence(
    datamodel: Dict[str, Any],
    changed: Optional[Dict[str, Any]] = None,
    rbac_policy_field_refs: Optional[list[Any]] = None,
) -> Dict[str, Any]:
    changed_data = changed if isinstance(changed, dict) else {}
    changed_entity_refs = _normalize_string_list(changed_data.get("entity"))
    changed_field_refs = _normalize_string_list(changed_data.get("field"))
    policy_refs = _normalize_string_list(rbac_policy_field_refs)
    entities = datamodel.get("entities", []) if isinstance(datamodel, dict) else []
    removed_field_refs: list[str] = []
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        if not isinstance(entity_id, str):
            continue
        for field in entity.get("fields", []) or []:
            if not isinstance(field, dict):
                continue
            field_key = field.get("key")
            if isinstance(field_key, str) and field.get("lifecycle") == "removed":
                removed_field_refs.append(f"{entity_id}.{field_key}")

    removed_policy_hits = sorted(ref for ref in removed_field_refs if ref in policy_refs)
    impacted_policy_refs = sorted(
        policy_ref
        for policy_ref in policy_refs
        if any(policy_ref == field_ref for field_ref in changed_field_refs)
        or any(
            policy_ref == entity_ref or policy_ref.startswith(f"{entity_ref}.")
            for entity_ref in changed_entity_refs
        )
    )

    if removed_policy_hits:
        return {
            "evidenceKey": DM_RBAC_POLICY_IMPACT_EVIDENCE,
            "state": "blocked",
            "reasonCode": "DM_RBAC_POLICY_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedPolicyRefs": removed_policy_hits,
            "hasPositiveEvidence": False,
        }

    if impacted_policy_refs:
        return {
            "evidenceKey": DM_RBAC_POLICY_IMPACT_EVIDENCE,
            "state": "allowed",
            "reasonCode": "DM_RBAC_POLICY_IMPACT_POSITIVE",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedPolicyRefs": impacted_policy_refs,
            "hasPositiveEvidence": True,
        }

    return {
        "evidenceKey": DM_RBAC_POLICY_IMPACT_EVIDENCE,
        "state": "blocked",
        "reasonCode": (
            "DM_RBAC_POLICY_IMPACT_NO_OVERLAP"
            if changed_entity_refs or changed_field_refs
            else "DM_RBAC_POLICY_IMPACT_NO_EVIDENCE"
        ),
        "changedEntityRefs": changed_entity_refs,
        "changedFieldRefs": changed_field_refs,
        "impactedPolicyRefs": [],
        "hasPositiveEvidence": False,
    }


def create_datamodel_page_binding_impact_evidence(
    datamodel: Dict[str, Any],
    changed: Optional[Dict[str, Any]] = None,
    page_binding_field_refs: Optional[list[Any]] = None,
) -> Dict[str, Any]:
    changed_data = changed if isinstance(changed, dict) else {}
    changed_entity_refs = _normalize_string_list(changed_data.get("entity"))
    changed_field_refs = _normalize_string_list(changed_data.get("field"))
    binding_refs = _normalize_string_list(page_binding_field_refs)
    entities = datamodel.get("entities", []) if isinstance(datamodel, dict) else []
    removed_field_refs: list[str] = []
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        if not isinstance(entity_id, str):
            continue
        for field in entity.get("fields", []) or []:
            if not isinstance(field, dict):
                continue
            field_key = field.get("key")
            if isinstance(field_key, str) and field.get("lifecycle") == "removed":
                removed_field_refs.append(f"{entity_id}.{field_key}")

    removed_binding_hits = sorted(ref for ref in removed_field_refs if ref in binding_refs)
    impacted_binding_refs = sorted(
        binding_ref
        for binding_ref in binding_refs
        if any(binding_ref == field_ref for field_ref in changed_field_refs)
        or any(
            binding_ref == entity_ref or binding_ref.startswith(f"{entity_ref}.")
            for entity_ref in changed_entity_refs
        )
    )

    if removed_binding_hits:
        return {
            "evidenceKey": DM_PAGE_BINDING_IMPACT_EVIDENCE,
            "state": "blocked",
            "reasonCode": "DM_PAGE_BINDING_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedPageBindingRefs": removed_binding_hits,
            "hasPositiveEvidence": False,
        }

    if impacted_binding_refs:
        return {
            "evidenceKey": DM_PAGE_BINDING_IMPACT_EVIDENCE,
            "state": "allowed",
            "reasonCode": "DM_PAGE_BINDING_IMPACT_POSITIVE",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedPageBindingRefs": impacted_binding_refs,
            "hasPositiveEvidence": True,
        }

    return {
        "evidenceKey": DM_PAGE_BINDING_IMPACT_EVIDENCE,
        "state": "blocked",
        "reasonCode": (
            "DM_PAGE_BINDING_IMPACT_NO_OVERLAP"
            if changed_entity_refs or changed_field_refs
            else "DM_PAGE_BINDING_IMPACT_NO_EVIDENCE"
        ),
        "changedEntityRefs": changed_entity_refs,
        "changedFieldRefs": changed_field_refs,
        "impactedPageBindingRefs": [],
        "hasPositiveEvidence": False,
    }


def create_datamodel_workflow_binding_impact_evidence(
    datamodel: Dict[str, Any],
    changed: Optional[Dict[str, Any]] = None,
    workflow_binding_field_refs: Optional[list[Any]] = None,
) -> Dict[str, Any]:
    changed_data = changed if isinstance(changed, dict) else {}
    changed_entity_refs = _normalize_string_list(changed_data.get("entity"))
    changed_field_refs = _normalize_string_list(changed_data.get("field"))
    binding_refs = _normalize_string_list(workflow_binding_field_refs)
    entities = datamodel.get("entities", []) if isinstance(datamodel, dict) else []
    removed_field_refs: list[str] = []
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get("id")
        if not isinstance(entity_id, str):
            continue
        for field in entity.get("fields", []) or []:
            if not isinstance(field, dict):
                continue
            field_key = field.get("key")
            if isinstance(field_key, str) and field.get("lifecycle") == "removed":
                removed_field_refs.append(f"{entity_id}.{field_key}")

    removed_binding_hits = sorted(ref for ref in removed_field_refs if ref in binding_refs)
    impacted_binding_refs = sorted(
        binding_ref
        for binding_ref in binding_refs
        if any(binding_ref == field_ref for field_ref in changed_field_refs)
        or any(
            binding_ref == entity_ref or binding_ref.startswith(f"{entity_ref}.")
            for entity_ref in changed_entity_refs
        )
    )

    if removed_binding_hits:
        return {
            "evidenceKey": DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
            "state": "blocked",
            "reasonCode": "DM_WORKFLOW_BINDING_IMPACT_FAIL_CLOSED_REMOVED_FIELD",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedWorkflowBindingRefs": removed_binding_hits,
            "hasPositiveEvidence": False,
        }

    if impacted_binding_refs:
        return {
            "evidenceKey": DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
            "state": "allowed",
            "reasonCode": "DM_WORKFLOW_BINDING_IMPACT_POSITIVE",
            "changedEntityRefs": changed_entity_refs,
            "changedFieldRefs": changed_field_refs,
            "impactedWorkflowBindingRefs": impacted_binding_refs,
            "hasPositiveEvidence": True,
        }

    return {
        "evidenceKey": DM_WORKFLOW_BINDING_IMPACT_EVIDENCE,
        "state": "blocked",
        "reasonCode": (
            "DM_WORKFLOW_BINDING_IMPACT_NO_OVERLAP"
            if changed_entity_refs or changed_field_refs
            else "DM_WORKFLOW_BINDING_IMPACT_NO_EVIDENCE"
        ),
        "changedEntityRefs": changed_entity_refs,
        "changedFieldRefs": changed_field_refs,
        "impactedWorkflowBindingRefs": [],
        "hasPositiveEvidence": False,
    }
