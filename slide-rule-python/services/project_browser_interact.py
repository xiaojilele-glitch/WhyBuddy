"""Closed Playwright actions against a private preview URL.

抄的开源合同，不贴泄漏提示词：

- OpenHands BrowserToolExecutor：typed navigate/click/type → observation
- Playwright public API（Apache-2.0）：page.click / fill / keyboard / mouse / evaluate
- vercel-labs/agent-browser：交互节点带稳定 index，模型先看 snapshot 再点

本模块是叶子：不 import services。调用方先用 leaked_browser_url_allowed
夹住 URL，这里只对已经放行的预览动手。缺 Playwright 就返回
project_browser_driver_unavailable，不许假装点到了。
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

_PLAYWRIGHT_JS = r"""
const fs = require("fs");
const action = JSON.parse(fs.readFileSync(0, "utf8"));
const { chromium } = %(require_playwright)s;
const url = action.url;
const origin = new URL(url).origin;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const now = page.url();
      if (now && !now.startsWith(origin)) {
        throw new Error("project_browser_external_url_forbidden");
      }
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  const nodes = page.locator("a,button,input,select,textarea,[role='button'],[role='link']");
  const count = await nodes.count();
  const pick = async (index) => {
    if (index == null || index < 0 || index >= count) {
      throw new Error("project_browser_target_missing");
    }
    return nodes.nth(index);
  };
  const op = action.op;
  if (op === "click") {
    if (action.x != null && action.y != null) {
      await page.mouse.click(action.x, action.y);
    } else {
      await (await pick(action.index)).click({ timeout: 8000 });
    }
  } else if (op === "type") {
    const target = action.index != null ? await pick(action.index) : page.locator(":focus");
    await target.fill(String(action.text || ""), { timeout: 8000 }).catch(async () => {
      await target.click({ timeout: 8000 });
      await page.keyboard.type(String(action.text || ""), { delay: 10 });
    });
    if (action.pressEnter) await page.keyboard.press("Enter");
  } else if (op === "move") {
    await page.mouse.move(action.x, action.y);
  } else if (op === "key") {
    await page.keyboard.press(String(action.key || ""));
  } else if (op === "select") {
    await (await pick(action.index)).selectOption(String(action.option || ""), { timeout: 8000 });
  } else if (op === "scroll") {
    if (action.toEnd && action.direction === "up") {
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (action.toEnd) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } else {
      await page.mouse.wheel(0, action.direction === "up" ? -480 : 480);
    }
  } else if (op === "evaluate") {
    action.evaluated = await page.evaluate(action.javascript);
  } else if (op !== "snapshot") {
    throw new Error("project_browser_action_invalid");
  }
  const snapshot = [];
  const n = Math.min(count, 40);
  for (let i = 0; i < n; i++) {
    const handle = nodes.nth(i);
    const tag = (await handle.evaluate((el) => el.tagName || "")).toLowerCase();
    const text = (await handle.innerText().catch(() => "")).trim().slice(0, 80);
    const name = (await handle.getAttribute("aria-label").catch(() => null))
      || (await handle.getAttribute("name").catch(() => null))
      || text;
    snapshot.push({ index: i, tag, name });
  }
  const title = await page.title();
  let screenshot = null;
  try {
    screenshot = (await page.screenshot({ type: "png" })).toString("base64");
  } catch (_) {}
  process.stdout.write(JSON.stringify({
    ok: true,
    op,
    url: page.url(),
    title,
    snapshot,
    evaluated: action.evaluated === undefined ? null : action.evaluated,
    screenshot,
  }));
  await browser.close();
})().catch((err) => {
  const code = String(err && err.message || "").startsWith("project_browser_")
    ? String(err.message)
    : "project_browser_action_failed";
  process.stdout.write(JSON.stringify({ ok: false, error: code }));
  process.exit(1);
});
"""


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def local_playwright_available() -> bool:
    if not shutil.which("node"):
        return False
    return (_repo_root() / "node_modules" / "@playwright" / "test").is_dir()


def run_browser_action(preview_url: str, action: dict, *, timeout_s: int = 30) -> dict:
    """Drive one closed action. Caller must have allowed the preview URL."""
    if not isinstance(preview_url, str) or not preview_url.strip():
        raise ValueError("project_browser_preview_not_ready")
    if not isinstance(action, dict) or not action.get("op"):
        raise ValueError("project_browser_action_invalid")
    if not local_playwright_available():
        raise ValueError("project_browser_driver_unavailable")
    payload = {**action, "url": preview_url.strip()}
    pkg = str(_repo_root() / "node_modules" / "@playwright" / "test")
    script = _PLAYWRIGHT_JS % {"require_playwright": f"require({json.dumps(pkg)})"}
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "interact.js"
        path.write_text(script, encoding="utf-8")
        try:
            result = subprocess.run(
                ["node", str(path)],
                input=json.dumps(payload, ensure_ascii=False),
                capture_output=True,
                text=True,
                timeout=timeout_s,
                cwd=str(_repo_root()),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("project_browser_action_failed") from exc
    try:
        body = json.loads((result.stdout or "").strip() or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("project_browser_action_failed") from exc
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise ValueError(str(body.get("error") or "project_browser_action_failed")[:240])
    result = {
        "op": body.get("op"),
        "url": body.get("url"),
        "title": body.get("title"),
        "snapshot": body.get("snapshot") or [],
        "evaluated": body.get("evaluated"),
        "interactive": True,
    }
    raw = body.get("screenshot")
    if isinstance(raw, str) and raw.strip():
        try:
            result["screenshotPng"] = base64.b64decode(raw, validate=False)
        except Exception:
            pass
    return result
