from services import schema_legal as legal


TYPES = {
    "WorkflowNodeDebugger": ("n8n-io/n8n", "workflow-canvas-node-inspector"),
    "QueryNotebookComposer": ("apache/superset", "query-notebook-cells"),
    "WarehouseBinHeatmap": ("frappe/erpnext", "warehouse-bin-heat-grid"),
    "ExperimentTrafficAllocator": ("gitlab-org/gitlab", "experiment-traffic-allocation"),
    "SlaBreachClock": ("zammad/zammad", "sla-countdown-escalation"),
    "WarehousePickRouteScanner": ("frappe/erpnext", "pick-route-scan-gate"),
}


def test_batch2_has_distinct_structural_evidence_and_renderers():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["structureFamily"] for block in selected}) == len(selected)
    assert len({block["rendererKey"] for block in selected}) == len(selected)
    assert all(block["structureDelta"] for block in selected)
    assert all(block["rendererStatus"] == "real" for block in selected)
    assert all(block["generationEnabled"] is True for block in selected)


def test_batch2_sources_and_contracts_stay_inside_existing_vocabulary():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo
        assert block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)


def test_batch2_is_not_a_table_alias_batch():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type in TYPES:
        block = blocks[block_type]
        evidence = " ".join((block["description"], block["structureDelta"], block["source"]["took"]))
        assert "表格换皮" not in evidence
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}
