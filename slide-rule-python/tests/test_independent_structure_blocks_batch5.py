from services import schema_legal as legal

TYPES = {
    "GeofenceVertexEditor": ("traccar/traccar-web", "map-polygon-vertex-inspector"),
    "RouteStopSequencer": ("traccar/traccar-web", "route-map-ordered-stop-track"),
    "PivotShelfComposer": ("apache/superset", "pivot-field-shelf-preview"),
    "BooleanRuleTreeBuilder": ("nocobase/nocobase", "nested-boolean-condition-groups"),
    "ImageCropTransformStudio": ("immich-app/immich", "image-crop-transform-canvas"),
    "DatasetJoinBuilder": ("metabase/metabase", "dual-dataset-join-condition"),
}

def test_batch5_families_are_globally_unique_and_real():
    structured = [block for block in legal.EXPERIENCE_BLOCKS if block.get("structureFamily")]
    assert len({block["structureFamily"] for block in structured}) == len(structured)
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[t] for t in TYPES]
    assert len({block["rendererKey"] for block in selected}) == 6
    assert all(block["rendererStatus"] == "real" and block["generationEnabled"] for block in selected)
    assert all(block["structureDelta"] for block in selected)

def test_batch5_sources_and_contracts_are_verified():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, (repo, family) in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo
        assert block["source"]["path"]
        assert block["structureFamily"] == family
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
        assert block["rendererKey"] not in {"data-table", "pro-table", "entity-table"}
