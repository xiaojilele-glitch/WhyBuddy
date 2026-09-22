"""Export project contracts from Pydantic; reject drift in both JSON Schema and TS.

Only this generator writes shared/project-runtime.generated.*. New schema forms
must be handled explicitly: silently emitting `any` would hide a wire mismatch.
"""

from __future__ import annotations

import argparse
import inspect
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "slide-rule-python"))
from models import project_runtime  # noqa: E402


def literal(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def ts_type(schema: dict) -> str:
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            raise ValueError(f"unsupported schema reference: {ref}")
        return ref.rsplit("/", 1)[1]
    if "const" in schema:
        return literal(schema["const"])
    if "enum" in schema:
        return " | ".join(literal(item) for item in schema["enum"])
    for union in ("anyOf", "oneOf"):
        if union in schema:
            return " | ".join(ts_type(item) for item in schema[union])
    kind = schema.get("type")
    if kind == "null":
        return "null"
    if kind in ("string", "number", "boolean"):
        return kind
    if kind == "integer":
        return "number"
    if kind == "array":
        return f"Array<{ts_type(schema.get('items', {}))}>"
    if kind == "object":
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        fields = [
            f"  {literal(name)}{'' if name in required else '?'}: {ts_type(value)};"
            for name, value in props.items()
        ]
        additional = schema.get("additionalProperties", True)
        if additional is not False:
            fields.append(f"  [key: string]: {ts_type(additional) if isinstance(additional, dict) else 'unknown'};")
        return "{\n" + "\n".join(fields) + "\n}"
    if not schema or not (set(schema) - {"title", "description", "default"}):
        return "unknown"
    raise ValueError(f"unsupported schema shape: {schema}")


def outputs() -> dict[str, str]:
    definitions: dict[str, dict] = {}
    for name, cls in inspect.getmembers(project_runtime, inspect.isclass):
        if cls is project_runtime.ProjectContract or not issubclass(cls, project_runtime.ProjectContract):
            continue
        schema = cls.model_json_schema()
        definitions.update(schema.pop("$defs", {}))
        definitions[name] = schema
    definitions = dict(sorted(definitions.items()))
    document = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": definitions}
    ts = "// Generated from models/project_runtime.py. Run pnpm run project:contracts:emit.\n\n"
    ts += "\n\n".join(f"export type {name} = {ts_type(schema)};" for name, schema in definitions.items()) + "\n"
    return {
        "project-runtime.generated.schema.json": json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        "project-runtime.generated.ts": ts,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--emit", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "shared")
    args = parser.parse_args()
    stale = []
    for name, expected in outputs().items():
        path = args.output_dir / name
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                stale.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    if stale:
        print("Project contract drift: " + ", ".join(stale), file=sys.stderr)
        return 1
    print("Project JSON Schema and TypeScript contracts synchronized.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
