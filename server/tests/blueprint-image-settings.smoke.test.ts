/**
 * autopilot-image-rendering-and-visual-system · Phase 4 · Task 37.1 (downgrade)
 *
 * Browser-level closure proof — DOWNGRADED variant per Task 37.3.
 *
 * ## Why a Node-based HTTP smoke test instead of Playwright
 *
 * Phase 4 Task 37.1 originally specified a Playwright `e2e/*.spec.ts` test
 * that boots the dev server, navigates to a route exposing the Stage C
 * effect_preview surface, and asserts the visible DOM contains the
 * production anchors (image gallery, schedule timeline, settings panel).
 *
 * Task 37.3 explicitly authorizes a downgrade when Playwright is not
 * present in the repository: «If Playwright is not installed in the
 * repo, do NOT install it as part of this task — instead, downgrade
 * 37.1 and 37.2 to use the existing testing stack ... prefer a
 * lightweight Node-based HTTP smoke test that hits
 * /api/blueprint/image-settings and a snapshot of the SSR render of
 * both pages with fixture data.»
 *
 * **Repo verification (2026-05-24):** A workspace-wide grep for
 * `playwright` across all package.json files returned 0 matches. The
 * `services/lobster-executor` skill metadata mentions
 * `"browser.playwright"` as a capability *string*, but no
 * `playwright` npm package is declared in any `package.json`
 * `dependencies` / `devDependencies`. There is also no `playwright.config.ts`
 * and no `e2e/` directory at the repo root. Installing Playwright would
 * require pulling browser binaries (Chromium / Firefox / WebKit)
 * — explicitly out of scope per Task 37.3.
 *
 * ## What this smoke test PROVES
 *
 * - `GET /api/blueprint/image-settings` is reachable from the canonical
 *   router factory `createBlueprintRouter()` over real HTTP (loopback
 *   socket via `http.createServer` + `fetch`).
 * - Response status is 200.
 * - Response body contains all 7 contracted fields with the right shape
 *   (`baseUrl`, `model`, `path`, `defaultSize`, `defaultAspect`,
 *   `timeoutMs`, `maskedApiKey`).
 * - The endpoint is wired through the **production** mounting path,
 *   not a synthetic in-test handler. This complements 35.2's
 *   algorithmic / sentinel-leak tests with an end-to-end reachability
 *   contract test.
 *
 * ## What this smoke test does NOT prove
 *
 * - It does NOT load the React frontend in a real browser.
 * - It does NOT assert any pixel-level / bounding-box / overlap
 *   geometry. Those guarantees would require a real browser engine
 *   (Playwright, Puppeteer, or jsdom + a layout engine, none of which
 *   are wired in this repo).
 * - The companion SSR-snapshot tests for `<EffectPreviewPanel>` and
 *   `<ProjectCockpitHome>` cover the DOM-level anchor-visibility
 *   closure. Together with this smoke test, they form the lightweight
 *   substitute for the full Playwright closure suite.
 *
 * ## Closure mapping back to the original Task 37
 *
 *   Task 37.1 (Playwright effect_preview route)
 *     → SSR-snapshot: EffectPreviewPanel.production-snapshot.test.tsx
 *     → API smoke:     this file
 *   Task 37.2 (Playwright /projects route + bounding-box overlap)
 *     → SSR-snapshot: ProjectCockpitHome.production-snapshot.test.tsx
 *   Task 37.3 (downgrade decision)
 *     → Documented in this preamble + in the two SSR-snapshot file
 *       preambles + in tasks.md final completion report.
 *
 * @see Requirements 9.1, 9.2, 14.4, 17.1
 */

import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBlueprintRouter } from "../routes/blueprint.js";

const ROUTE_PATH = "/api/blueprint/image-settings";

/**
 * Spin up a real HTTP server with the canonical blueprint router mounted,
 * resolve the loopback URL, and run the supplied handler against it. The
 * server is closed in `finally` so each test case is isolated.
 */
async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/blueprint", createBlueprintRouter());

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

interface ImageSettingsBody {
  readonly baseUrl: string | null;
  readonly model: string;
  readonly path: string;
  readonly defaultSize: string;
  readonly defaultAspect: string;
  readonly timeoutMs: number;
  readonly maskedApiKey: string | null;
}

describe("Phase 4 Task 37.1 (downgraded) — /api/blueprint/image-settings smoke", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is reachable through the canonical router factory and returns the contracted shape", async () => {
    // Stub a configured-but-non-secret-leaking environment. The shape
    // assertions below intentionally do not depend on whether a key is
    // configured — that's already covered by 35.2.
    vi.stubEnv("IMAGE_GEN_API_KEY", "");
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.com");
    vi.stubEnv("IMAGE_GEN_MODEL", "");
    vi.stubEnv("IMAGE_GEN_PATH", "");
    vi.stubEnv("IMAGE_GEN_DEFAULT_SIZE", "");
    vi.stubEnv("IMAGE_GEN_DEFAULT_ASPECT", "");
    vi.stubEnv("IMAGE_GEN_TIMEOUT_MS", "");
    vi.stubEnv("IMAGE_GEN_DISABLED", "");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${ROUTE_PATH}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);

      const body = (await response.json()) as ImageSettingsBody;

      // All 7 contracted fields must be present with the right shape.
      expect(body).toHaveProperty("baseUrl");
      expect(body).toHaveProperty("model");
      expect(body).toHaveProperty("path");
      expect(body).toHaveProperty("defaultSize");
      expect(body).toHaveProperty("defaultAspect");
      expect(body).toHaveProperty("timeoutMs");
      expect(body).toHaveProperty("maskedApiKey");

      // `baseUrl` is either null or a non-empty string.
      if (body.baseUrl !== null) {
        expect(typeof body.baseUrl).toBe("string");
        expect(body.baseUrl.length).toBeGreaterThan(0);
      }

      // Defaulted enum-shaped string fields.
      expect(typeof body.model).toBe("string");
      expect(body.model.length).toBeGreaterThan(0);
      expect(typeof body.path).toBe("string");
      expect(body.path.startsWith("/")).toBe(true);
      expect(typeof body.defaultSize).toBe("string");
      expect(body.defaultSize.length).toBeGreaterThan(0);
      expect(typeof body.defaultAspect).toBe("string");
      expect(body.defaultAspect.length).toBeGreaterThan(0);

      // `timeoutMs` is a positive integer.
      expect(typeof body.timeoutMs).toBe("number");
      expect(Number.isInteger(body.timeoutMs)).toBe(true);
      expect(body.timeoutMs).toBeGreaterThan(0);

      // `maskedApiKey` is either null or a string. The exact masking
      // algorithm is exhaustively tested in
      // server/routes/__tests__/blueprint-image-settings.test.ts (35.2).
      expect(
        body.maskedApiKey === null || typeof body.maskedApiKey === "string",
      ).toBe(true);
    });
  });

  it("never embeds the raw IMAGE_GEN_API_KEY value when a configured key is supplied", async () => {
    // Use a unique sentinel; if any future regression surfaces the raw
    // key, this assertion will catch it independently of 35.2 (which
    // exercises the same defense from a different angle).
    const leakSentinel = "SMOKE-NEVER-LEAK-PROD-CLOSURE-KEY-XYZ";
    expect(leakSentinel.length).toBeGreaterThan(14);

    vi.stubEnv("IMAGE_GEN_API_KEY", leakSentinel);
    vi.stubEnv("IMAGE_GEN_BASE_URL", "https://image-proxy.example.com");
    vi.stubEnv("IMAGE_GEN_DISABLED", "");
    vi.stubEnv("AUTOPILOT_REAL_RUNTIME", "");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${ROUTE_PATH}`);
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text.includes(leakSentinel)).toBe(false);

      const body = JSON.parse(text) as ImageSettingsBody;
      expect(JSON.stringify(body).includes(leakSentinel)).toBe(false);

      // Sanity: masked variant present so we know the route did read env.
      expect(body.maskedApiKey).not.toBeNull();
    });
  });
});
