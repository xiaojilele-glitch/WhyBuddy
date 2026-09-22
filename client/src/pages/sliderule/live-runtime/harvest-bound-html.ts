/**
 * 从打过孔的 HTML 里收回页面上已经写着的数，当作运行时那一份。
 *
 * ⚠ 2026-09-07 社区烘焙坊进销存 sr-20260907143221：
 *   bind 把孔打上之后，seedRuntimeState 给每个空实体铺 12 行「高原成品 /
 *   规格 1 / 134」。收银台货架、配方、原料档案各编各的，对不上；
 *   生成时写在 HTML 里的「日式北海道奶油吐司 ¥22 / 特级法国面包粉」被盖掉。
 *
 *   种子的前提是「零行 = 空壳，展会上不好看」。HTML 页不是空壳——第 3 步
 *   已经画了一套对得上的样例。再造一套假的，就是两个世界。
 *
 * 做法：扫 data-rows / data-record 里 data-field 的**现有文案**，去重后
 * 收成 RuntimeRow。配方里点到的成品/原料如果还没有档案，补一行，
 * 不许另起「高原成品」。
 *
 * 不编数。孔是空的就空着。
 */

import type { FiveSystemEntity, FiveSystemModel } from "../system-screens/five-system-model";
import { resolveRefEntityId } from "../system-screens/five-system-model";
import { isSeedRow } from "./demo-seed";
import { rowsHost } from "./html-binding-runtime";
import type { RuntimeRow, RuntimeState } from "./live-runtime";

export const HARVEST_BOUND_HTML_VERSION = "harvest-bound-html-v1";

function parseDoc(html: string): Document | null {
  if (!html || typeof DOMParser === "undefined") return null;
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

/** tbody 不能当 div 的孩子，浏览器会扔掉；拆出来放进 table 再扫。 */
function docsFromHtml(html: string): Document[] {
  const docs: Document[] = [];
  const main = parseDoc(html);
  if (main) docs.push(main);
  const tableBits = html.match(/<(tbody|thead)\b[\s\S]*?<\/\1>/gi) || [];
  for (const bit of tableBits) {
    const wrapped = parseDoc(`<table>${bit}</table>`);
    if (wrapped) docs.push(wrapped);
  }
  return docs;
}

function fieldText(el: Element): string {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function collectFields(scope: Element, inRow: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  const nodes = [
    ...(scope.matches("[data-field]") ? [scope] : []),
    ...Array.from(scope.querySelectorAll("[data-field]")),
  ];
  for (const el of nodes) {
    const owner = el.parentElement?.closest("[data-rows],[data-record]");
    if (owner && owner !== scope && scope.contains(owner)) {
      const ownedIndependently = owner.hasAttribute("data-rows") || !inRow;
      if (ownedIndependently) continue;
    }
    const fid = el.getAttribute("data-field") || "";
    if (!fid || values[fid] != null) continue;
    const text = fieldText(el);
    if (!text || text === "—" || text === "-") continue;
    values[fid] = text;
  }
  return values;
}

function parseValue(
  raw: string,
  field: { type?: string; format?: string } | undefined
): unknown {
  const type = String(field?.type ?? "string").toLowerCase();
  const fmt = String(field?.format ?? "").toLowerCase();
  if (type === "number" || fmt === "money" || fmt === "percent" || fmt === "progress") {
    const n = Number(
      raw.replace(/[¥$￥,，\s]/g, "").replace(/%$/, "")
    );
    if (!Number.isNaN(n)) return n;
  }
  return raw;
}

function nameFieldId(entity: FiveSystemEntity): string | undefined {
  const fields = (entity.fields ?? []).filter(f => f?.id);
  const named = fields.find(
    f =>
      String(f.type ?? "string").toLowerCase() === "string" &&
      /name|title|label/i.test(String(f.id))
  );
  if (named?.id) return named.id;
  return fields.find(f => String(f.type ?? "string").toLowerCase() === "string")
    ?.id;
}

function valuesKey(values: Record<string, unknown>): string {
  const keys = Object.keys(values).sort();
  return keys.map(k => `${k}=${String(values[k] ?? "")}`).join("\0");
}

function mergeIntoNamed(
  bucket: RuntimeRow[],
  values: Record<string, unknown>,
  entity: FiveSystemEntity,
  nowIso: string
): void {
  if (Object.keys(values).length === 0) return;
  const fid = nameFieldId(entity);
  const name = fid ? String(values[fid] ?? "").trim() : "";
  // ⚠ `name` 非空**蕴含** fid 存在（上一行就是这么算的），但 TS 看不出这层
  //   蕴含，于是 `r.values?.[fid]` 报 TS2538「undefined 不能当索引」。把前提
  //   写明即可——不是放松判断，两个条件的真值组合与原来完全一致。
  if (fid && name) {
    const prev = bucket.find(
      r => String(r.values?.[fid] ?? "").trim() === name
    );
    if (prev) {
      for (const [k, v] of Object.entries(values)) {
        if (prev.values[k] == null || prev.values[k] === "") prev.values[k] = v;
      }
      return;
    }
  } else {
    const key = valuesKey(values);
    if (bucket.some(r => valuesKey(r.values || {}) === key)) return;
  }
  bucket.push({
    id: `harvest-${entity.id}-${bucket.length + 1}`,
    values,
    createdAt: nowIso,
  });
}

function listItems(host: Element): Element[] {
  const tag = host.tagName;
  if (tag === "TBODY" || tag === "THEAD" || tag === "TABLE") {
    return Array.from(host.querySelectorAll(":scope > tr")).filter(
      el => !el.querySelector("[data-rows]")
    );
  }
  return Array.from(host.children).filter(
    el => el.querySelector("[data-field],[data-cell]") || el.hasAttribute("data-field")
  );
}

function harvestDoc(
  doc: Document,
  byId: Map<string, FiveSystemEntity>,
  buckets: Record<string, RuntimeRow[]>,
  nowIso: string
): void {
  const fieldOf = (entityId: string, fid: string) =>
    (byId.get(entityId)?.fields ?? []).find(f => f?.id === fid);

  doc.querySelectorAll("[data-rows]").forEach(box => {
    const entityId = box.getAttribute("data-rows") || "";
    if (!entityId || !byId.has(entityId)) return;
    const host = rowsHost(box);
    const items = listItems(host);
    const targets = items.length ? items : [host];
    if (!buckets[entityId]) buckets[entityId] = [];
    const entity = byId.get(entityId)!;
    for (const item of targets) {
      const raw = collectFields(item, true);
      const values: Record<string, unknown> = {};
      for (const [fid, text] of Object.entries(raw)) {
        values[fid] = parseValue(text, fieldOf(entityId, fid));
      }
      mergeIntoNamed(buckets[entityId], values, entity, nowIso);
    }
  });

  doc.querySelectorAll("[data-record]").forEach(box => {
    if (box.closest("[data-rows]")) return;
    const entityId = box.getAttribute("data-record") || "";
    if (!entityId || !byId.has(entityId)) return;
    if (!buckets[entityId]) buckets[entityId] = [];
    const entity = byId.get(entityId)!;
    const raw = collectFields(box, false);
    const values: Record<string, unknown> = {};
    for (const [fid, text] of Object.entries(raw)) {
      values[fid] = parseValue(text, fieldOf(entityId, fid));
    }
    mergeIntoNamed(buckets[entityId], values, entity, nowIso);
  });
}

function displayOf(row: RuntimeRow, entity: FiveSystemEntity): string {
  const fid = nameFieldId(entity);
  const v = fid ? row.values?.[fid] : undefined;
  return String(v ?? "").trim();
}

function ensureNamed(
  buckets: Record<string, RuntimeRow[]>,
  def: FiveSystemEntity,
  name: string,
  nowIso: string
): void {
  const fid = nameFieldId(def);
  const text = name.trim();
  if (!fid || !text) return;
  const rows = buckets[def.id] ?? (buckets[def.id] = []);
  mergeIntoNamed(rows, { [fid]: text }, def, nowIso);
}

/**
 * 配方/单据里点到的名字，必须在被引用的那张表里找得到。
 * 找不到就补那一行——补的是页面上已经出现的名字，不是另编一套。
 */
function linkHarvested(
  buckets: Record<string, RuntimeRow[]>,
  defs: FiveSystemEntity[],
  nowIso: string
): void {
  const byId = new Map(defs.map(e => [e.id, e]));
  const allIds = defs.map(e => e.id);

  for (const def of defs) {
    const rows = buckets[def.id];
    if (!rows?.length) continue;

    for (const field of def.fields ?? []) {
      if (!field?.id) continue;
      if (String(field.type ?? "").toLowerCase() === "ref") {
        const targetId = resolveRefEntityId(field, allIds).target;
        const target = targetId ? byId.get(targetId) : undefined;
        if (!target) continue;
        const targetName = nameFieldId(target);
        for (const row of rows) {
          const cur = String(row.values?.[field.id] ?? "").trim();
          if (cur) {
            ensureNamed(buckets, target, cur, nowIso);
            continue;
          }
          const pick = (buckets[target.id] ?? [])[0];
          const name = pick && targetName ? displayOf(pick, target) : "";
          if (name) row.values[field.id] = name;
        }
        continue;
      }
      // 非 ref 但名字就是「对方的名称」：recipe.material_name → material
      const stem = String(field.id).replace(/_name$|_title$|_label$/i, "");
      if (stem === field.id) continue;
      const target = byId.get(stem);
      if (!target) continue;
      for (const row of rows) {
        const cur = String(row.values?.[field.id] ?? "").trim();
        if (cur) ensureNamed(buckets, target, cur, nowIso);
      }
    }
  }
}

export function harvestBoundHtml(
  htmlList: readonly string[],
  model: FiveSystemModel | null | undefined,
  nowMs: number = Date.now()
): Record<string, RuntimeRow[]> {
  const defs = (model?.datamodel?.entities ?? []).filter(e => e?.id);
  if (!defs.length || !htmlList.length) return {};
  const byId = new Map(defs.map(e => [e.id, e]));
  const buckets: Record<string, RuntimeRow[]> = {};
  const nowIso = new Date(nowMs).toISOString();

  for (const html of htmlList) {
    for (const doc of docsFromHtml(html)) {
      harvestDoc(doc, byId, buckets, nowIso);
    }
  }
  linkHarvested(buckets, defs, nowIso);
  return buckets;
}

/**
 * 把收回来的行写进运行时。全是种子或空表才替换——用户自己写过的行不碰。
 * 替换掉「高原成品」那种种子，正是这场要消灭的东西。
 */
export function adoptHarvestedRows(
  state: RuntimeState,
  harvested: Record<string, RuntimeRow[]>,
  model: FiveSystemModel | null | undefined
): RuntimeState {
  const defs = (model?.datamodel?.entities ?? []).filter(e => e?.id);
  if (!defs.length) return state;
  let changed = false;
  const next: Record<string, RuntimeRow[]> = { ...state.entities };
  const seen = { ...(state.seededEntities ?? {}) };

  for (const entity of defs) {
    const got = harvested[entity.id];
    if (!got?.length) continue;
    const existing = next[entity.id] ?? [];
    const onlySeed = existing.length === 0 || existing.every(isSeedRow);
    if (!onlySeed) continue;
    next[entity.id] = got;
    seen[entity.id] = true;
    changed = true;
  }
  if (!changed) return state;
  return { ...state, entities: next, seededEntities: seen };
}

/**
 * HTML 页这条路上，没收回来的实体也记「已经判过」——不许 seedRuntimeState
 * 再给它们铺 12 行编的数字。空就是空。
 */
export function lockSeedDecisions(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined
): RuntimeState {
  const defs = (model?.datamodel?.entities ?? []).filter(e => e?.id);
  if (!defs.length) return state;
  const seen = { ...(state.seededEntities ?? {}) };
  let changed = false;
  for (const entity of defs) {
    if (seen[entity.id]) continue;
    seen[entity.id] = true;
    changed = true;
  }
  return changed ? { ...state, seededEntities: seen } : state;
}
