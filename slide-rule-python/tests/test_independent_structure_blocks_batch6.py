from services import schema_legal as legal

TYPES={
    "CompositeRoleBuilder":("keycloak/keycloak","direct-inherited-role-membership"),
    "HttpRequestWorkbench":("activepieces/activepieces","http-request-response-transaction"),
    "BomAssemblyTreeEditor":("frappe/erpnext","bom-quantity-cost-rollup-tree"),
    "AlertThresholdBandEditor":("grafana/grafana","threshold-band-state-preview"),
    "MediaTrimTimeline":("resource-space/resource-space","media-in-out-range-timeline"),
    "CronOccurrenceBuilder":("windmill-labs/windmill","cron-fields-future-occurrences"),
}

def test_batch6_families_are_globally_unique_and_real():
    structured=[block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured})==len(structured)
    blocks={block["type"]:block for block in legal.EXPERIENCE_BLOCKS}
    selected=[blocks[t] for t in TYPES]
    assert len({block["rendererKey"] for block in selected})==6
    assert all(block["rendererStatus"]=="real" and block["generationEnabled"] and block["structureDelta"] for block in selected)

def test_batch6_sources_and_contracts_are_verified():
    blocks={block["type"]:block for block in legal.EXPERIENCE_BLOCKS}
    for block_type,(repo,family) in TYPES.items():
        block=blocks[block_type]
        assert block["source"]["repo"]==repo and block["source"]["path"]
        assert block["structureFamily"]==family
        assert set(block["events"])<=set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"])<=set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
        assert block["rendererKey"] not in {"data-table","pro-table","entity-table"}
