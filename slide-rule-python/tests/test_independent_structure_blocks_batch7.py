from services import schema_legal as legal


TYPES = {
    "OcrRegionCorrectionCanvas": ("immich-app/immich", "ocr-box-text-confidence-editor"),
    "QueryExecutionPlanInspector": ("openobserve/openobserve", "query-operator-cost-tree"),
    "ColumnProfileWorkbench": ("datahub-project/datahub", "column-distribution-quality-inspector"),
    "CertificateRotationPlanner": ("goauthentik/authentik", "overlapping-certificate-rotation-window"),
    "WebhookPayloadSchemaExplorer": ("activepieces/activepieces", "webhook-sample-schema-path-explorer"),
    "ArtifactProvenanceVerifier": ("gitlab-org/gitlab", "signed-artifact-provenance-evidence-chain"),
}


def test_batch7_families_are_globally_unique_and_real():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["rendererKey"] for block in selected}) == 6
    assert all(block["rendererStatus"] == "real" and block["generationEnabled"] and block["structureDelta"] for block in selected)


def test_batch7_sources_and_contracts_are_verified():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo and block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}


# 2026-08-11 去重后基线从 401 降到 350，理由见 batch8 那个文件里的长注释。
def test_batch7_catalog_keeps_its_baseline_without_alias_counting():
    assert legal.EXPERIENCE_BLOCK_CATALOG_VERSION >= 316
    assert len(legal.EXPERIENCE_BLOCKS) >= 316
    assert len({block["type"] for block in legal.EXPERIENCE_BLOCKS}) == len(legal.EXPERIENCE_BLOCKS)
    assert set(TYPES) <= {block["type"] for block in legal.EXPERIENCE_BLOCKS}
