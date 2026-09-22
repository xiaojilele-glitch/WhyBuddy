from services import schema_legal as legal


TYPES = {
    "SignatureFieldCanvas": "documenso/documenso",
    "AlertGroupAccordion": "grafana/grafana",
    "EvidenceCollectionWorkspace": "DefectDojo/django-DefectDojo",
    "AssetReviewLightbox": "immich-app/immich",
    "PaymentAllocationWorkbench": "invoiceninja/invoiceninja",
    "DeploymentRolloutTrack": "argoproj/argo-cd",
}


def test_independent_blocks_have_distinct_structural_evidence():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    selected = [blocks[block_type] for block_type in TYPES]
    assert len({block["structureFamily"] for block in selected}) == len(selected)
    assert all(block["structureDelta"] for block in selected)
    assert len({block["rendererKey"] for block in selected}) == len(selected)


def test_independent_blocks_keep_real_sources_and_existing_contract_vocabulary():
    blocks = {block["type"]: block for block in legal.EXPERIENCE_BLOCKS}
    for block_type, repo in TYPES.items():
        block = blocks[block_type]
        assert block["source"]["repo"] == repo
        assert block["source"]["path"]
        assert block["rendererStatus"] == "real"
        assert block["generationEnabled"] is True
        assert set(block["events"]) <= set(legal.EXPERIENCE_BLOCK_EVENT_TYPES)
        assert set(block["allowedRegions"]) <= set(legal.EXPERIENCE_BLOCK_ALLOWED_REGIONS)
