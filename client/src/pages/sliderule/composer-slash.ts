/**
 * composer-slash — 输入框里 `/` 唤起的能力选择器（纯逻辑层）。
 *
 * 2026-08-25 用户裁决：技能和连接器要能在**发需求的那一刻**选，
 * 而不是先去库里装、再回来推演。参照豆包工作台的 `扩展中心`。
 *
 * ## 为什么锚在输入框上方，而不是跟着光标走
 *
 * 跟着光标走要在 textarea 里量插入符坐标，标准做法是"镜像 div"
 * （react-mentions / textarea-caret-position 那一套）：复制一份同样字体、
 * 同样换行规则的隐藏 div，把光标前的文本塞进去，量最后一个 span 的位置。
 * 它对字号、行高、padding、缩放、IME、滚动位置全都敏感，是一整类难复现
 * bug 的来源。ChatGPT / Claude / 豆包的输入框都不这么干——面板固定锚在
 * 输入框上方。这里照抄这个更省事也更稳的选择。
 *
 * ## 这个模块只管"判定"，不碰 DOM
 *
 * 判定难点全在"什么时候**不该**弹"。真实输入里斜杠到处都是：
 * `https://x`、`2026/08/25`、`and/or`。这些都不该弹面板，而"错弹"比
 * "不弹"烦人得多——它会吃掉方向键和回车。所以下面每条正向判据都配了
 * 一条"这种情况不许弹"。
 */

export type {
  SlashKind,
  SlashItem,
  RehearsalSlashVerb,
} from "@/lib/slash-item";
import type { SlashItem, SlashKind, RehearsalSlashVerb } from "@/lib/slash-item";

export const REHEARSAL_SLASH_ITEMS: SlashItem[] = [
  {
    key: "rehearse",
    kind: "rehearsal",
    name: "推演",
    description: "讨论需求并拟定计划",
  },
  {
    key: "refine",
    kind: "rehearsal",
    name: "精修",
    description: "在现有模型上改，不另起炉灶",
  },
  {
    key: "challenge",
    kind: "rehearsal",
    name: "质疑",
    description: "失效一次结论，不把挑选交给模型",
  },
  {
    key: "scope",
    kind: "rehearsal",
    name: "计划",
    description: "拟定或修改执行计划",
  },
  {
    key: "restore",
    kind: "rehearsal",
    name: "回退",
    description: "恢复上一版模型",
  },
];

/**
 * `/` 面板给人点的推演动词。只留「计划」。
 *
 * ⚠ 2026-09-19 空会话：用户圈了推演 / 精修 / 质疑 / 回退，问是不是没用了。
 *   现在是自由 Agent 编排，那四个是 HTML 工厂遥控器，点了也对不上工程档。
 *   目录 `REHEARSAL_SLASH_ITEMS` 仍在——手打 `/精修` 还走闸，菜单不再推销。
 *
 * 只认 `scope`，不认「不是工厂的都留下」：新加一个工厂动词默认不进面板。
 */
export function visibleComposerRehearsalItems(
  items: readonly SlashItem[] = REHEARSAL_SLASH_ITEMS
): SlashItem[] {
  return items.filter(item => item.key === "scope");
}

export const COMPOSER_SLASH_REHEARSAL_ITEMS: SlashItem[] =
  visibleComposerRehearsalItems();

export interface SlashQuery {
  /** `/` 所在下标 */
  start: number;
  /** 光标下标（查询串的右界） */
  end: number;
  /** `/` 后面已经打的字（不含斜杠） */
  query: string;
}

/** 斜杠前面只允许是行首或空白。`https://`、`2026/08/25`、`and/or` 都不算。 */
function opensHere(text: string, slash: number): boolean {
  if (slash === 0) return true;
  return /\s/.test(text[slash - 1]!);
}

/**
 * 光标正处在哪个 `/词` 里。不在就返回 null。
 *
 * 从光标往回扫，**遇到空白就停**。这一条同时管住两件事：
 *   1. 光标已经离开斜杠段（`/天气 帮我做个看板`）——面板必须关掉，
 *      否则方向键和回车全被它吃掉；
 *   2. 查询串里不可能夹着空白（往回扫早就在空白处停了）。
 *
 * ⚠ 别再补一条 `if (/\s/.test(query)) return null`。写过一版，**它是死代码**：
 *   往回扫的停止条件已经保证 query 里没有空白，两条守卫互相掩护，
 *   把任意一条改坏判据都照样全绿（2026-08-25 变异测出来的）。
 *   一件事只留一个判定点。
 */
export function slashQueryAt(
  text: string,
  caret: number
): SlashQuery | null {
  if (typeof text !== "string") return null;
  const end = Math.max(0, Math.min(caret, text.length));
  for (let i = end - 1; i >= 0; i -= 1) {
    const ch = text[i]!;
    if (ch === "/") {
      if (!opensHere(text, i)) return null;
      return { start: i, end, query: text.slice(i + 1, end) };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * 「/ 技能·连接器」提示钮替用户打的那个斜杠：在光标处插一个 `/`。
 *
 * 2026-08-26 用户反馈"输入框中应该加入提醒"——斜杠唤起是学来的手势，
 * 界面上不写出来等于没有。提示钮点下去走的是**同一条**路径：真的往正文
 * 插一个 `/`，再由 `slashQueryAt` 判定弹不弹（别给同一件事另设一套状态）。
 *
 * ⚠ 前一个字符不是空白时要**先补一个空格**。`slashQueryAt` 只认行首或空白
 *   后面的斜杠（`https://`、`2026/08/25`、`and/or` 都不许弹），紧挨着字插
 *   进去面板不会弹——用户看到的就是"点了没反应"。
 *   判据 `composer-slash.test.ts` 里那条直接拿 `slashQueryAt` 验插完的结果，
 *   而不是数空格：两条规则钉在一起，改坏哪一条都红。
 */
export function seedSlash(
  text: string,
  caret: number
): { text: string; caret: number } {
  const src = typeof text === "string" ? text : "";
  const at = Math.max(0, Math.min(Number(caret) || 0, src.length));
  const before = src.slice(0, at);
  const after = src.slice(at);
  const glue = before && !/\s$/.test(before) ? " " : "";
  return {
    text: `${before}${glue}/${after}`,
    caret: before.length + glue.length + 1,
  };
}

function score(item: SlashItem, q: string): number {
  if (!q) return 0;
  const name = item.name.toLowerCase();
  const key = item.key.toLowerCase();
  const desc = item.description.toLowerCase();
  if (name.startsWith(q) || key.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (key.includes(q)) return 2;
  if (desc.includes(q)) return 3;
  return -1;
}

/**
 * 按已打的字筛。
 *
 * ⚠ 排序**稳定**：同分的保持传入顺序。用 Array.prototype.sort 的比较函数
 *   返回分差即可（V8 的 sort 自 V7.0 起是稳定的）。不稳定的话每敲一个字
 *   同分项就换一次位置，第一项跳来跳去，回车选中的东西跟眼睛看到的不是
 *   同一个。
 */
export function filterSlashItems(
  items: readonly SlashItem[],
  query: string
): SlashItem[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...items];
  return items
    .map(item => ({ item, s: score(item, q) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map(x => x.item);
}

/**
 * 选中之后把 `/查询串` 从正文里摘掉。
 *
 * 摘掉而不是替换成能力名：能力是**挂在这一轮上的东西**（一枚 chip），
 * 不是正文的一部分。留在正文里的话它会跟着进提示词，模型会把"/天气"当成
 * 用户的措辞去理解。
 */
export function applySlashPick(
  text: string,
  q: SlashQuery
): { text: string; caret: number } {
  const next = text.slice(0, q.start) + text.slice(q.end);
  return { text: next, caret: q.start };
}

/** ↑↓ 在列表里绕圈。空列表返回 0，调用方据此不渲染高亮。 */
export function moveHighlight(
  count: number,
  current: number,
  delta: number
): number {
  if (!(count > 0)) return 0;
  return ((current + delta) % count + count) % count;
}

/** 这一轮挂了哪些能力 → 给驱动层的载荷（只带 id 和类型，不带描述文案）。 */
export function pickedPayload(
  picked: readonly SlashItem[]
): Array<{ kind: SlashKind; key: string }> {
  return picked.map(p => ({ kind: p.kind, key: p.key }));
}

const REHEARSAL_VERBS: ReadonlyArray<{
  cmd: string;
  verb: RehearsalSlashVerb;
}> = [
  { cmd: "/推演", verb: "rehearse" },
  { cmd: "/精修", verb: "refine" },
  { cmd: "/质疑", verb: "challenge" },
  { cmd: "/计划", verb: "scope" },
  { cmd: "/plan", verb: "scope" },
  { cmd: "/范围", verb: "scope" },
  { cmd: "/回退", verb: "restore" },
];

/**
 * 正文是不是一条推演动词。只认整句开头的 `/推演` 等。
 * `https://`、`2026/08/25`、`and/or` 都不是。
 */
export function parseRehearsalSlash(text: string): RehearsalSlashVerb | null {
  const t = String(text || "").trim();
  if (!t.startsWith("/")) return null;
  for (const { cmd, verb } of REHEARSAL_VERBS) {
    if (t === cmd || t.startsWith(`${cmd} `) || t.startsWith(`${cmd}\n`)) {
      return verb;
    }
    // 与服务端 `_is_slash_rehearse` 同形：`/推演请假` 也算推演。
    if (t.startsWith(cmd)) return verb;
  }
  return null;
}

/**
 * 斜杠动词 → 控制面 forcedTool。
 *
 * ⚠ `/推演` 不得返回 rehearse。空会话带 rehearse 会跳过停泊、直接点火
 * （2026-08-27 合同：未确认卡由服务端 park，客户端不许 yolo）。
 */
export function forcedToolForRehearsalVerb(
  verb: RehearsalSlashVerb | null
): string | undefined {
  if (verb === "refine") return "refine";
  if (verb === "challenge") return "challenge";
  if (verb === "restore") return "restore_version";
  if (verb === "scope") return "enter_plan_mode";
  return undefined;
}

/** `/范围 请假系统` → `请假系统`；裸 `/范围` → 空串。不是斜杠动词则原文。 */
export function rehearsalSlashRemainder(text: string): string {
  const t = String(text || "").trim();
  for (const { cmd } of REHEARSAL_VERBS) {
    if (t === cmd) return "";
    if (
      t.startsWith(`${cmd} `) ||
      t.startsWith(`${cmd}\n`) ||
      t.startsWith(cmd)
    ) {
      return t.slice(cmd.length).trim();
    }
  }
  return t;
}

/**
 * `/范围` 的 POST userText：余量，否则当前 goal。
 * `/推演` 必须留前缀，服务端 `_is_slash_rehearse` 靠它 park。
 */
export function controlUserTextForSlash(
  userText: string,
  currentGoal: string
): string {
  const raw = String(userText || "").trim();
  if (parseRehearsalSlash(raw) !== "scope") return raw;
  return rehearsalSlashRemainder(raw) || String(currentGoal || "").trim();
}

/**
 * 选中推演动词：把 `/查询串` 补成完整命令，不摘成芯片。
 *
 * ⚠ 2026-09-19 空会话：点「计划」，框里变成 `/计划`，面板没关，还得再点一次。
 *   补全后光标停在词上，`slashQueryAt` 仍认这段斜杠；textarea 的 onSelect
 *   跟着 setSelectionRange 再扫一遍，把刚关掉的面板叫回来。
 *   尾巴补一个空格——跟「`/天气 帮我做个看板` 必须关面板」是同一条规则。
 */
export function applyRehearsalSlashPick(
  text: string,
  q: SlashQuery,
  item: SlashItem
): { text: string; caret: number } {
  const command = `/${item.name} `;
  const next = `${text.slice(0, q.start)}${command}${text.slice(q.end)}`;
  return { text: next, caret: q.start + command.length };
}

/**
 * 商店已装技能 → `/` 面板条目。没装的不进。
 *
 * 选中后走 `applySkillSlashPick`，在正文里留下 `@slug`，这一轮自由
 * Agent 就按这份 SKILL.md 编排。不是勾选存档，也不是死流程。
 */
export function installedSkillSlashItems(
  skills: ReadonlyArray<{
    slug: string;
    name?: string;
    description?: string;
    installed?: boolean;
  }>
): SlashItem[] {
  const out: SlashItem[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const key = String(skill.slug || "").trim();
    if (!key || seen.has(key) || skill.installed === false) continue;
    seen.add(key);
    out.push({
      key,
      kind: "skill",
      name: String(skill.name || key).trim() || key,
      description: String(skill.description || "").trim(),
    });
  }
  return out;
}

/**
 * 选中已装技能：把 `/查询串` 换成 `@slug `。
 *
 * ⚠ 不能走 `applySlashPick` 只摘斜杠。摘完正文里没有点名，服务端
 *   只看见「做个 PPT」，技能正文不会预加载。
 */
export function applySkillSlashPick(
  text: string,
  q: SlashQuery,
  item: SlashItem
): { text: string; caret: number } {
  const mention = `@${item.key} `;
  const next = `${text.slice(0, q.start)}${mention}${text.slice(q.end)}`;
  return { text: next, caret: q.start + mention.length };
}
