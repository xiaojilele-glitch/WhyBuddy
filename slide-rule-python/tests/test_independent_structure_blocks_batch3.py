from services import schema_legal as legal


TYPES = {
    "ResumableUploadQueue": ("nextcloud/server", "resumable-transfer-queue"),
    "DistributedTraceWaterfall": ("getsentry/sentry", "nested-span-waterfall-inspector"),
    "ExpressionDataMapper": ("n8n-io/n8n", "data-tree-expression-output"),
    "SessionReplayScrubber": ("getsentry/sentry", "replay-frame-event-scrubber"),
    "DashboardGridComposer": ("grafana/grafana", "spatial-dashboard-grid-editor"),
    "LiveLogTailer": ("grafana/grafana", "live-log-stream-console"),
}


def test_batch3_structural_families_are_globally_unique():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["rendererKey"] for block in selected}) == len(selected)
    assert all(block["structureDelta"] for block in selected)
    assert all(block["rendererStatus"] == "real" for block in selected)
    assert all(block["generationEnabled"] is True for block in selected)


def test_batch3_sources_and_contracts_use_verified_existing_vocabulary():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo
        assert block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)


def test_batch3_has_no_table_renderer_aliases():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type in TYPES:
        block = blocks[block_type]
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}
        assert "不是" in block["structureDelta"]
