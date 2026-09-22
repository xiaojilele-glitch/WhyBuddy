"""Turn a homepage reference image into an auditable reconstruction contract."""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .archetype_legal import device_domain_bar as _device_domain_bar
from .archetype_legal import supported_devices as _supported_devices

from sliderule_llm.config import default_max_tokens


PAGE_RECONSTRUCTION_VERSION = "page-reconstruction-v1"


class ViewportSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    width: int = Field(gt=0, le=10000)
    height: int = Field(gt=0, le=10000)


class RegionGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def stays_inside_image(self) -> "RegionGeometry":
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("geometry must stay inside normalized image bounds")
        return self


class ComponentMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    library: Literal["antd", "antd-mobile"]
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(min_length=1, max_length=240)


class PageRegionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=1, le=100)
    geometry: RegionGeometry
    hierarchy: int = Field(ge=1, le=6)
    layout: str = Field(min_length=1, max_length=400)
    alignment: str = Field(min_length=1, max_length=160)
    spacing: str = Field(min_length=1, max_length=240)
    typography: str = Field(min_length=1, max_length=320)
    colors: list[str] = Field(default_factory=list, max_length=16)
    imagery: str = Field(default="", max_length=400)
    component: ComponentMapping
    dataBindings: list[str] = Field(default_factory=list, max_length=32)
    fixedFacts: list[str] = Field(default_factory=list, max_length=32)
    confidence: float = Field(ge=0, le=1)


class PageReconstructionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device: str
    viewport: ViewportSpec
    componentLibrary: Literal["antd", "antd-mobile"]
    regions: list[PageRegionSpec] = Field(min_length=1, max_length=30)
    designTokens: dict[str, str] = Field(default_factory=dict)
    fixedVisualFacts: list[str] = Field(default_factory=list, max_length=64)
    allowedAdaptations: list[str] = Field(default_factory=list, max_length=32)
    forbiddenDeviations: list[str] = Field(default_factory=list, max_length=64)
    uncertainRegions: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("device")
    @classmethod
    def device_must_be_supported(cls, value: str) -> str:
        raw = str(value or "").strip()
        if raw not in set(_supported_devices()):
            raise ValueError(
                f"device must be one of {_device_domain_bar()}"
            )
        return raw

    @model_validator(mode="after")
    def uses_one_component_library(self) -> "PageReconstructionSpec":
        wrong = [region.id for region in self.regions if region.component.library != self.componentLibrary]
        if wrong:
            raise ValueError(
                "component library mismatch in regions: " + ", ".join(wrong)
            )
        return self


def _result(
    status: Literal["ready", "skipped", "failed"],
    *,
    spec: Optional[dict[str, Any]] = None,
    prompt: str = "",
    diagnostic: str = "",
) -> dict[str, Any]:
    return {
        "version": PAGE_RECONSTRUCTION_VERSION,
        "status": status,
        "spec": spec,
        "prompt": prompt,
        "diagnostic": diagnostic,
    }


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("response contains no JSON object")
        text = match.group(0)
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("response root must be an object")
    return payload


def compile_reconstruction_prompt(spec: PageReconstructionSpec | dict[str, Any]) -> str:
    parsed = spec if isinstance(spec, PageReconstructionSpec) else PageReconstructionSpec.model_validate(spec)
    library = "Ant Design Mobile" if parsed.componentLibrary == "antd-mobile" else "Ant Design"
    lines = [
        "PAGE RECONSTRUCTION CONTRACT",
        f"Device: {parsed.device}; viewport: {parsed.viewport.width}x{parsed.viewport.height}; component library: {library}.",
        "Reproduce the following regions in ascending order. Relative geometry is authoritative:",
    ]
    for region in sorted(parsed.regions, key=lambda item: (item.order, item.id)):
        geometry = region.geometry
        lines.append(
            f"- {region.order}. {region.id} ({region.role}): "
            f"x={geometry.x:.3f}, y={geometry.y:.3f}, width={geometry.width:.3f}, height={geometry.height:.3f}; "
            f"hierarchy={region.hierarchy}; layout={region.layout}; alignment={region.alignment}; "
            f"spacing={region.spacing}; typography={region.typography}; colors={', '.join(region.colors) or 'inherit'}; "
            f"imagery={region.imagery or 'none'}; component={library} {region.component.name} ({region.component.purpose}); "
            f"dataBindings={', '.join(region.dataBindings) or 'none'}; fixedFacts={'; '.join(region.fixedFacts) or 'none'}; "
            f"confidence={region.confidence:.2f}."
        )
    if parsed.designTokens:
        lines.append("Design tokens: " + "; ".join(f"{key}={value}" for key, value in sorted(parsed.designTokens.items())) + ".")
    if parsed.fixedVisualFacts:
        lines.append("Fixed visual facts: " + "; ".join(parsed.fixedVisualFacts) + ".")
    if parsed.allowedAdaptations:
        lines.append("Allowed adaptations: " + "; ".join(parsed.allowedAdaptations) + ".")
    if parsed.forbiddenDeviations:
        lines.append("Forbidden deviations: " + "; ".join(parsed.forbiddenDeviations) + ".")
    if parsed.uncertainRegions:
        lines.append("Uncertain regions: " + "; ".join(parsed.uncertainRegions) + ".")
    lines.append("Business data must still come only from the supplied DataModel and valid dataRef/rowsRef bindings.")
    return "\n".join(lines)


def _analysis_instruction(design_brief: str, datamodel: dict[str, Any], device: str) -> str:
    # tablet 跟 desktop 同一套 antd（aside 壳）。写成 `phone else antd`
    # 对平板是对的——不要改成手机 mobile，page_shell 认的是 aside。
    library = "antd-mobile" if device == "phone" else "antd"
    model_text = json.dumps(datamodel, ensure_ascii=False, separators=(",", ":"))[:7000]
    return f"""Analyze the attached generated homepage visual as a reconstruction engineer.
Return one strict JSON object and no markdown. Do not redesign the page. Describe what is visibly present so another model can reproduce it as executable UI.

Authoritative device: {device}
Allowed component library: {library}
Business brief: {design_brief}
DataModel: {model_text}

Required JSON shape:
{{
  "device": "{_device_domain_bar()}",
  "viewport": {{"width": 1440, "height": 900}},
  "componentLibrary": "antd|antd-mobile",
  "regions": [{{
    "id": "stable-kebab-id", "role": "business purpose", "order": 1,
    "geometry": {{"x": 0.0, "y": 0.0, "width": 1.0, "height": 0.5}},
    "hierarchy": 1, "layout": "visible layout", "alignment": "visible alignment",
    "spacing": "visible spacing", "typography": "visible type hierarchy",
    "colors": ["#RRGGBB"], "imagery": "placement/aspect/crop or empty",
    "component": {{"library": "{library}", "name": "official component name", "purpose": "why it maps"}},
    "dataBindings": ["real entity/field ids only"], "fixedFacts": ["facts that must not move"],
    "confidence": 0.0
  }}],
  "designTokens": {{"token": "visible value"}},
  "fixedVisualFacts": [], "allowedAdaptations": [], "forbiddenDeviations": [], "uncertainRegions": []
}}

Coordinates are fractions of the full image. Include every major visible section in top-to-bottom order. Use only entity and field ids that exist in DataModel. Map phone regions only to Ant Design Mobile; desktop and tablet regions map to Ant Design. Record uncertainty instead of inventing invisible details."""


def analyze_page_reference(
    reference_image_b64: Optional[str],
    *,
    design_brief: str,
    datamodel: dict[str, Any],
    device: str,
    llm_call: Optional[Callable[..., Any]] = None,
) -> dict[str, Any]:
    if not reference_image_b64:
        return _result("skipped", diagnostic="reference image unavailable")
    if str(device or "").strip() not in set(_supported_devices()):
        return _result(
            "skipped",
            diagnostic=f"device {device!r} is not in {_device_domain_bar()}",
        )
    try:
        if llm_call is None:
            from sliderule_llm.client import call_llm_with_retry

            llm_call = call_llm_with_retry
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": _analysis_instruction(design_brief, datamodel, device)},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"}},
            ],
        }]
        response = llm_call(
            messages,
            max_attempts=2,
            backoff_ms=1500,
            temperature=0.1,
            max_tokens=default_max_tokens(),
        )
        parsed = PageReconstructionSpec.model_validate(_parse_json_object(response.content or ""))
        if parsed.device != device:
            raise ValueError(f"device mismatch: expected {device}, got {parsed.device}")
        expected_library = "antd-mobile" if device == "phone" else "antd"
        if parsed.componentLibrary != expected_library:
            raise ValueError(
                f"component library mismatch: expected {expected_library}, got {parsed.componentLibrary}"
            )
        spec_dump = parsed.model_dump(mode="json")
        return _result("ready", spec=spec_dump, prompt=compile_reconstruction_prompt(parsed))
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        return _result("failed", diagnostic=f"invalid reconstruction spec: {str(exc)[:500]}")
    except Exception as exc:  # noqa: BLE001 - visual analysis is a fail-open enhancement
        return _result("failed", diagnostic=f"reconstruction analysis failed: {str(exc)[:500]}")
