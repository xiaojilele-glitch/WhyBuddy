"""Deterministic source export from a validated immutable manifest.

The archive contains saved source, never a live sandbox directory: installed
packages, application databases, environment secrets and provider handles are
not part of a source revision. Exporting is independent of delivery approval.
"""

import io
import json
import zipfile

from services.project_manifest import build_manifest


def source_archive(files, revision, artifacts=None) -> bytes:
    if build_manifest(files) != revision.manifest:
        raise ValueError("project_export_manifest_mismatch")
    metadata = {
        "schemaVersion": 1, "revision": revision.revision,
        "treeHash": revision.treeHash, "templateVersion": revision.templateVersion,
        "manifest": revision.manifest.model_dump(),
        "businessDataIncluded": False, "secretsIncluded": False,
    }
    entries = {"source/" + path: content for path, content in files.items()}
    entries["whybuddy-export.json"] = json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    entries["RUNNING.md"] = (
        "# Saved WhyBuddy project\n\n"
        "Run commands in source/: npm ci --ignore-scripts, npm run check, "
        "npm test, npm run build, npm run dev. Use Node 22.\n\n"
        "For the task application, npm start serves the production build. "
        "Set WHYBUDDY_APP_DATA_DIR to a persistent directory. "
        "Create your application administrator on first use.\n\n"
        "This archive contains source and a hash manifest. Application data, "
        "passwords, workspace credentials and preview access are separate. "
        "An export is not a browser verification or a public deployment.\n"
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            item = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, content.encode("utf-8"))
        for path, payload in sorted((artifacts or {}).items()):
            if not isinstance(payload, (bytes, bytearray)) or not path:
                continue
            item = zipfile.ZipInfo("artifacts/" + str(path).lstrip("/"), date_time=(1980, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, bytes(payload))
    return output.getvalue()
