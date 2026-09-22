# Sliderule Single Device Authority

## Goal

Every newly generated application must have exactly one target device: `desktop` or `phone`. The decision must be written once to `appbundle.preferredDevice` and consumed unchanged by reference-image generation, palette extraction, homepage design, screenshot verification, persistence, and runtime rendering. Missing or failed device classification must never trigger two layout generations.

## Upstream Guidance

The installed runtime uses Ant Design 5.29, Ant Design Mobile 5.42, and Ant Design Pro Components 2.8. The official projects separate desktop and mobile component systems but do not decide an application's product posture. That decision belongs to the application layer.

WhyBuddy already follows the useful upstream boundary:

- desktop surfaces use Ant Design and Pro Components;
- phone surfaces live under `client/src/pages/sliderule/live-runtime/phone-mobile/` and load Ant Design Mobile lazily;
- shared schema data and actions are passed into device-specific renderers.

This change preserves that boundary. It does not copy upstream source or add another UI framework.

## Device Decision Contract

`appbundle.preferredDevice` is required for newly generated models and accepts only:

- `desktop`
- `phone`

The authoritative resolver uses this precedence:

1. An explicit device in the user's goal wins.
   - `PC`, `电脑`, `桌面端`, `网页`, or an explicitly desktop web product selects `desktop`.
   - `手机`, `移动端`, `App`, or `小程序` selects `phone`.
   - If the same instruction explicitly requests both classes, it is not treated as a single explicit override; the generated model decision is used.
2. Without an explicit override, preserve the valid `appbundle.preferredDevice` selected by the five-system generation LLM. The generation prompt must require the LLM to decide from the complete page model, landing-page shape, and primary operating posture.
3. If the field is missing, invalid, or unavailable because classification failed, deterministically select `desktop`.

There is no `unspecified` result after normalization and no fallback that generates both devices.

## Generation Flow

The generated model is normalized before the strict structural gate and before any visual enrichment:

```text
goal + generated five-system model
  -> resolve preferredDevice
  -> write appbundle.preferredDevice
  -> strict model gate
  -> reference image for preferredDevice
  -> palette extraction from that image
  -> homepage design for preferredDevice
  -> screenshot verification for preferredDevice
  -> persistence and closure evidence
```

All visual stages receive the same normalized value. Progress events report that device and use `current=1,total=1`.

The existing `unspecified -> default + phone` branch is removed. `freeformOverview` contains only the generated `root`; newly generated models do not attach a second `mobile.root` design.

## Prompt And Gate Behavior

The legal-model prompt changes `preferredDevice` from optional guidance to a required decision. It retains the operating-posture rubric and adds these rules:

- explicit user device wording has priority;
- judge the whole generated product, especially its landing page, not an isolated capture page;
- output exactly one supported value;
- never omit the field to request responsive or dual generation.

The model gate gains a strict generated-model mode that rejects a missing or invalid `preferredDevice`. Historic restore paths remain readable. Before historic or partially generated models enter visual enrichment, normalization writes the deterministic fallback, so they also execute only one visual path.

## Runtime And Component Routing

The normalized model exposes one available device tier:

- `desktop` uses Ant Design and Ant Design Pro Components.
- `phone` uses components from the existing `phone-mobile` lazy chunk and Ant Design Mobile.

The runtime must not offer a switch to a device tier for which no design was generated. Shared business actions, bindings, and data stay device-neutral; only rendering components differ.

No new custom replacement controls are introduced. Existing official-component contracts under `phone-mobile` remain authoritative.

## Screenshot Contract

The screenshot service resolves the persisted model's `preferredDevice` and captures that tier. A missing request device uses the model device. A conflicting request cannot cause the renderer to look for an unavailable tier or synthesize a second layout; it captures the authoritative tier and reports the actual device in diagnostics.

Screenshot verification inside homepage generation receives the same device value used for the reference image and design JSON.

## Compatibility

Existing stored applications may have no `preferredDevice`, an old `tablet` value, or both `root` and `mobile.root`.

- Reads remain tolerant so existing sessions can open.
- When such a model is regenerated or enriched, normalization chooses one device and new output follows the single-device contract.
- Existing dual-layout payloads are not destructively rewritten during read-only viewing.
- `tablet` is not generated by the new pipeline and falls back to `desktop` when normalization is required.

## Failure Handling

- Explicit-device parsing is deterministic and does not call an external service.
- A valid LLM choice is preserved when there is no explicit override.
- Missing or illegal LLM output becomes `desktop` before enrichment.
- Image generation, palette extraction, design generation, or screenshot verification may still fail open according to their existing contracts, but none of those failures may change the chosen device or start a second-device attempt.

## Verification

Backend tests must prove:

- explicit desktop wording overrides a generated `phone` value;
- explicit phone wording overrides a generated `desktop` value;
- a valid LLM value is preserved when the goal is device-neutral;
- missing, invalid, and `tablet` values normalize to `desktop`;
- model generation reaches the strict gate with exactly one valid device;
- missing device no longer calls homepage design twice;
- image, palette, design, screenshot verification, progress events, and persisted summary use the same device.

Frontend tests must prove:

- new desktop models expose only the desktop tier;
- new phone models expose only the phone tier;
- phone runtime surfaces remain Ant Design Mobile-only at their device boundary;
- desktop runtime surfaces remain Ant Design/Pro Components;
- historic dual-layout models remain viewable without causing new generation.

Final verification includes focused Python and Vitest suites, TypeScript checking, production build, and at least two real Chinese-topic runs: one explicit device request and one device-neutral request. Each run must show one `monitor.design` event with `current=1,total=1` and one authentic screenshot at the selected tier.
