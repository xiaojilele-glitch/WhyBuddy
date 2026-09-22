"""Actual project schemas must survive the real control-client HTTP boundary.

The first live model smoke received HTTP 400 before any tool could be selected:
Gemini's gateway cannot resolve the $ref emitted for project_patch FileChange.
These tests inspect the payload sent by call_control_llm, not just a utility.
"""

import asyncio
import copy
import json
from types import SimpleNamespace

import httpx
import pytest

from services.project_tool_contracts import PROJECT_TOOLS
from sliderule_llm import control_client


def test_actual_project_schemas_inline_at_control_http_boundary(monkeypatch):
    before = copy.deepcopy(PROJECT_TOOLS)
    requests = []

    def handle(request):
        payload = json.loads(request.content)
        requests.append(payload)
        patch = next(tool["function"] for tool in payload["tools"] if tool["function"]["name"] == "project_patch")
        item = patch["parameters"]["properties"]["changes"]["items"]
        # The gateway failure was here. Return 400 if the real caller forgets
        # to wire inlining; a passing helper-only unit test cannot hide it.
        if "$ref" in item:
            return httpx.Response(400, json={"error": {"message": "Unknown name $ref"}})
        assert item["type"] == "object"
        assert item["additionalProperties"] is False
        assert set(item["required"]) == {"path", "content", "expectedSha256"}
        assert item["properties"]["content"]["anyOf"][0]["maxLength"] == 512 * 1024
        assert item["properties"]["expectedSha256"]["anyOf"][0]["pattern"] == r"^[0-9a-f]{64}$"
        assert "$defs" not in patch["parameters"]
        return httpx.Response(200, json={"model": "gateway-model", "choices": [{"message": {"content": "ok"}}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(control_client.httpx, "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(control_client, "get_llm_config", lambda: SimpleNamespace(
        api_key="fixture-key", base_url="https://gateway.invalid/v1", model="fixture-model", timeout_ms=1000))
    result = asyncio.run(control_client.call_control_llm([{"role": "user", "content": "Edit source"}], tools=PROJECT_TOOLS))
    assert result.content == "ok"
    assert len(requests) == 1
    assert requests[0]["tool_choice"] == "auto"
    assert [item["function"]["name"] for item in requests[0]["tools"]] == [item["function"]["name"] for item in PROJECT_TOOLS]
    assert PROJECT_TOOLS == before
    assert "$defs" in next(t["function"]["parameters"] for t in PROJECT_TOOLS if t["function"]["name"] == "project_patch")


def test_reference_siblings_keep_both_validation_constraints():
    schema = {"$defs": {"word": {"type": "string", "maxLength": 8}}, "type": "object",
        "properties": {"name": {"$ref": "#/$defs/word", "minLength": 3, "maxLength": 5}}}
    normalized = control_client._inline_tool_schema(schema)
    assert normalized["properties"]["name"] == {"allOf": [
        {"type": "string", "maxLength": 8}, {"minLength": 3, "maxLength": 5}]}


def test_nested_refs_escaped_names_and_literal_ref_data():
    schema = {"$defs": {"a/b~c": {"type": "string"}, "outer": {
        "type": "array", "items": {"$ref": "#/$defs/a~1b~0c"}}},
        "type": "object", "properties": {"$ref": {"$ref": "#/$defs/outer"}},
        "default": {"$ref": "literal data"}, "const": {"definitions": "literal"}}
    normalized = control_client._inline_tool_schema(schema)
    assert normalized["properties"]["$ref"] == {"type": "array", "items": {"type": "string"}}
    assert normalized["default"] == {"$ref": "literal data"}
    assert normalized["const"] == {"definitions": "literal"}


def test_disjoint_reference_siblings_cannot_reopen_closed_object():
    target = {"type": "object", "additionalProperties": False}
    sibling = {"properties": {"name": {"type": "string"}}}
    schema = {"$defs": {"closed": target}, "$ref": "#/$defs/closed", **sibling}
    # Canonical schema rejects {name: "x"}. Flattening properties into the
    # target would let its additionalProperties:false recognize and allow it.
    normalized = control_client._inline_tool_schema(schema)
    assert normalized == {"allOf": [target, sibling]}
    assert "properties" not in normalized["allOf"][0]


def test_annotation_siblings_merge_without_changing_validations():
    schema = {"$defs": {"name": {"type": "string", "minLength": 2, "title": "old"}},
        "$ref": "#/$defs/name", "title": "new", "description": "Name"}
    assert control_client._inline_tool_schema(schema) == {
        "type": "string", "minLength": 2, "title": "new", "description": "Name"}


@pytest.mark.parametrize("schema", [
    {"$ref": "https://external.invalid/schema"},
    {"$ref": "#/$defs/missing"},
    {"$defs": {"loop": {"$ref": "#/$defs/loop"}}, "$ref": "#/$defs/loop"},
    {"$defs": {"a": {"$ref": "#/$defs/b"}, "b": {"$ref": "#/$defs/a"}}, "$ref": "#/$defs/a"},
    {"$defs": {"bad": "not a schema"}, "$ref": "#/$defs/bad"},
])
def test_unresolved_or_recursive_schemas_fail_before_wire(schema):
    with pytest.raises(ValueError, match="tool_schema"):
        control_client._control_chat_payload([], "m", 0.2, 2048,
            [{"type": "function", "function": {"name": "test", "parameters": schema}}])


def test_boolean_reference_sibling_is_conjunction():
    schema = {"$defs": {"reject": False}, "$ref": "#/$defs/reject", "type": "object"}
    assert control_client._inline_tool_schema(schema) == {"allOf": [False, {"type": "object"}]}
