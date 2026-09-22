# Sliderule Page Reconstruction Spec Design

## Goal

Insert an inspectable image-understanding stage between homepage reference-image generation and executable Freeform page generation. Marketing landing pages must use a complete homepage visual rather than a standalone Hero photograph.

## Architecture

The visual pipeline becomes:

```text
five-system model
  -> design brief + image brief
  -> complete homepage reference image
  -> PageReconstructionSpec analysis
  -> deterministic reconstruction prompt
  -> reference image + reconstruction prompt + business brief + DataModel + component constraints
  -> validated Freeform page JSON
  -> rendered screenshot critique
```

`services/page_reconstruction.py` owns the multimodal analysis contract, validation, and deterministic prompt compilation. `services/freeform_block.py` remains the orchestrator and persists the analysis beside the generated page as `page.pageReconstruction`.

## PageReconstructionSpec

The versioned structure contains:

- authoritative `device` and `viewport`;
- ordered page regions with purpose, hierarchy, relative geometry, alignment, spacing, typography, colors, imagery, and component mapping;
- global design tokens and component-library choice (`antd` or `antd-mobile`);
- fixed visual facts that must be preserved;
- allowed adaptations and forbidden deviations;
- uncertain regions with confidence values.

The analyzer receives the reference image, business brief, compact DataModel facts, device, and component constraints. It returns strict JSON. Invalid, incomplete, mismatched-device, or unavailable analysis fails open and returns a diagnostic instead of blocking the already valid business model.

## Persistence And Auditability

The synchronous landing page records:

```json
{
  "pageReconstruction": {
    "version": "page-reconstruction-v1",
    "status": "ready|skipped|failed",
    "spec": {},
    "prompt": "...",
    "diagnostic": "..."
  }
}
```

The prompt is compiled deterministically from the validated spec. It is not accepted as free-form text from the vision model. The final page generator receives both the compiled prompt and the original image, so geometry is explicit while visual details remain available.

## Image Semantics

Monitor and dashboard pages continue to generate one content-area UI visual for the authoritative device. Marketing landing pages generate two independent assets concurrently: a complete homepage visual showing the actual page composition, typography, actions, content sections, and primary media, plus a text-free Hero photograph used only by the runtime `landing-hero` node. The complete visual is analyzed and screenshot-compared but is never mounted as the Hero image, preventing a page screenshot from being nested inside the generated page. The runtime shell remains outside the generated content tree.

Only the selected landing page runs synchronously. Other eligible pages remain deferred. Only `desktop` or `phone` is generated.

## Failure Handling

- No reference image: record `skipped`; use the existing text-only page generation path.
- Vision analysis failure or invalid JSON: record `failed`; continue with the reference image and original brief.
- Page generation failure: preserve reconstruction evidence, mark `freeformOverviewStatus=failed`, and retain the fixed runtime fallback.
- Screenshot critique remains a bounded enhancement and cannot invalidate a structurally valid generated page.

## Verification

Tests must prove that the analyzer validates and compiles a spec, malformed analysis fails open, reconstruction evidence is persisted and passed into page generation, no-image runs are marked skipped, marketing prompts request a complete page visual, and single-device/deferred-page behavior remains unchanged.
