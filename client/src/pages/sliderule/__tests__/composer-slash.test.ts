/**
 * `/` 选择器的判定层。
 *
 * 每条"该弹"都配了一条"不该弹"——错弹比不弹烦人得多，它会吃掉方向键和回车。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  applyRehearsalSlashPick,
  applySkillSlashPick,
  applySlashPick,
  COMPOSER_SLASH_REHEARSAL_ITEMS,
  controlUserTextForSlash,
  filterSlashItems,
  forcedToolForRehearsalVerb,
  installedSkillSlashItems,
  moveHighlight,
  parseRehearsalSlash,
  pickedPayload,
  REHEARSAL_SLASH_ITEMS,
  rehearsalSlashRemainder,
  seedSlash,
  slashQueryAt,
  visibleComposerRehearsalItems,
  type SlashItem,
} from "../composer-slash";
import { mentionedSkillSlugs } from "../../../lib/mentioned-skills";

const ITEMS: SlashItem[] = [
  { key: "weather", kind: "connector", name: "天气", description: "按城市取真实天气预报" },
  { key: "stock", kind: "connector", name: "股票行情", description: "A 股与指数实时行情" },
  {
    key: "wind",
    kind: "connector",
    name: "Wind 金融数据",
    description: "机构级行情",
    unavailable: "还没配置凭据",
  },
  { key: "frontend-design", kind: "skill", name: "frontend-design", description: "前端界面风格" },
];

describe("什么时候弹", () => {
  it("行首打斜杠就弹", () => {
    expect(slashQueryAt("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(slashQueryAt("/天气", 3)).toEqual({ start: 0, end: 3, query: "天气" });
  });

  it("空格后面打斜杠也弹", () => {
    const q = slashQueryAt("帮我做个看板 /股票", 9);
    expect(q).toEqual({ start: 7, end: 9, query: "股" });
  });

  it("换行后面也算行首", () => {
    expect(slashQueryAt("第一行\n/天", 6)?.query).toBe("天");
  });
});

describe("什么时候不许弹（这半边才是判据的价值）", () => {
  it("网址里的斜杠不弹", () => {
    expect(slashQueryAt("https://miantuan.ai", 9)).toBeNull();
    expect(slashQueryAt("https://miantuan.ai", 19)).toBeNull();
  });

  it("日期里的斜杠不弹", () => {
    expect(slashQueryAt("2026/08/25", 7)).toBeNull();
  });

  it("词中间的斜杠不弹", () => {
    expect(slashQueryAt("and/or", 6)).toBeNull();
  });

  it("查询串里一出现空格就关掉——用户已经在写正文了", () => {
    expect(slashQueryAt("/天气 帮我做个看板", 4)).toBeNull();
    expect(slashQueryAt("/天气 帮我做个看板", 10)).toBeNull();
  });

  it("光标在斜杠段之外时不弹", () => {
    // 正文写完又把光标挪回前面
    expect(slashQueryAt("/天气", 0)).toBeNull();
    expect(slashQueryAt("没有斜杠", 4)).toBeNull();
  });
});

describe("筛选", () => {
  it("空查询给全部", () => {
    expect(filterSlashItems(ITEMS, "")).toHaveLength(ITEMS.length);
    expect(filterSlashItems(ITEMS, "   ")).toHaveLength(ITEMS.length);
  });

  it("名字前缀排在包含前面", () => {
    const r = filterSlashItems(ITEMS, "股");
    expect(r[0]!.key).toBe("stock");
  });

  it("描述里命中也算，但排在后面", () => {
    const r = filterSlashItems(ITEMS, "指数");
    expect(r.map(x => x.key)).toEqual(["stock"]);
  });

  it("英文不分大小写", () => {
    expect(filterSlashItems(ITEMS, "FRONTEND").map(x => x.key)).toEqual([
      "frontend-design",
    ]);
  });

  it("不可用的照样列出来——不然用户以为产品没这个能力", () => {
    const r = filterSlashItems(ITEMS, "wind");
    expect(r.map(x => x.key)).toEqual(["wind"]);
    expect(r[0]!.unavailable).toBeTruthy();
  });

  it("同分保持原顺序（不稳定排序会让第一项跳来跳去）", () => {
    const many: SlashItem[] = [
      { key: "a", kind: "skill", name: "同名", description: "" },
      { key: "b", kind: "skill", name: "同名", description: "" },
      { key: "c", kind: "skill", name: "同名", description: "" },
    ];
    expect(filterSlashItems(many, "同名").map(x => x.key)).toEqual(["a", "b", "c"]);
  });

  it("搜不到就是空——不许兜底给全部", () => {
    expect(filterSlashItems(ITEMS, "压根不存在")).toEqual([]);
  });
});

describe("选中之后", () => {
  it("把 /查询串 从正文里摘掉，不是替换成能力名", () => {
    const text = "帮我做个看板 /天气";
    const q = slashQueryAt(text, text.length)!;
    const r = applySlashPick(text, q);
    expect(r.text).toBe("帮我做个看板 ");
    expect(r.caret).toBe(7);
    // 反面：能力名不许留在正文里——留下的话它会跟着进提示词
    expect(r.text).not.toContain("天气");
    expect(r.text).not.toContain("/");
  });

  it("正文后半段保住", () => {
    const text = "/天气 之后还有字";
    // 光标停在 "/天" 之后（此时后面还没打空格的场景由调用方保证）
    const q = { start: 0, end: 3, query: "天气" };
    expect(applySlashPick(text, q).text).toBe(" 之后还有字");
  });
});

describe("键盘", () => {
  it("上下绕圈", () => {
    expect(moveHighlight(3, 0, 1)).toBe(1);
    expect(moveHighlight(3, 2, 1)).toBe(0);
    expect(moveHighlight(3, 0, -1)).toBe(2);
  });

  it("空列表不炸", () => {
    expect(moveHighlight(0, 0, 1)).toBe(0);
    expect(moveHighlight(0, 5, -1)).toBe(0);
  });
});

describe("载荷", () => {
  it("只带 id 和类型，不把描述文案送进推演", () => {
    const payload = pickedPayload([ITEMS[0]!, ITEMS[3]!]);
    expect(payload).toEqual([
      { kind: "connector", key: "weather" },
      { kind: "skill", key: "frontend-design" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("按城市取");
  });
});

describe("seedSlash：提示钮替用户打的那个斜杠", () => {
  /*
   * ⚠ 这一组判据**不数空格**，一律拿 slashQueryAt 验插完的结果——
   *   插斜杠和"什么时候算斜杠"是同一件事的两半，钉在一起改坏哪半都红。
   *   只断言 `text === "做个天气页 /"` 的话，把 opensHere 改坏照样绿。
   */
  const opens = (text: string, caret: number) => slashQueryAt(text, caret);

  it("空输入框：插出来就是一个斜杠，面板认得出", () => {
    const r = seedSlash("", 0);
    expect(r.text).toBe("/");
    expect(r.caret).toBe(1);
    expect(opens(r.text, r.caret)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("正文末尾紧挨着字：补一个空格，面板照样认得出", () => {
    const r = seedSlash("做个天气页", 5);
    expect(opens(r.text, r.caret)).not.toBeNull();
    expect(opens(r.text, r.caret)!.query).toBe("");
    // 反向：不补空格的话面板压根不弹（这正是"点了没反应"）
    expect(opens("做个天气页/", 6)).toBeNull();
  });

  it("光标前已经是空白：不再补第二个空格", () => {
    const r = seedSlash("做个天气页 ", 6);
    expect(r.text).toBe("做个天气页 /");
    expect(opens(r.text, r.caret)).not.toBeNull();
  });

  it("插在正文中间：后面的字原样留着，光标停在斜杠后面", () => {
    const r = seedSlash("前面 后面", 3);
    expect(r.text).toBe("前面 /后面");
    expect(r.text.slice(r.caret)).toBe("后面");
    expect(opens(r.text, r.caret)).not.toBeNull();
    // 光标前是空白，所以不补第二个空格；补了的话正文里会多出个空格
    expect(r.text).not.toContain("  ");
  });

  it("越界/脏光标一律夹回来，不抛", () => {
    expect(seedSlash("abc", 999).caret).toBe(5);
    expect(seedSlash("abc", -3).text).toBe("/abc");
    expect(seedSlash(undefined as unknown as string, 0).text).toBe("/");
  });
});

describe("输入框提醒", () => {
  it("判定层不再夹一份 UI 文案——提醒只在工具条那颗钮上", () => {
    const src = readFileSync(
      new URL("../composer-slash.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toContain("COMPOSER_SLASH_HINT");
    expect(src).not.toContain("即可选择技能、连接器或伙伴");
  });
});

describe("推演动词", () => {
  it("/推演 /精修 /质疑 /范围 /回退 都是 rehearsal，网址日期仍不是", () => {
    expect(parseRehearsalSlash("/推演")).toBe("rehearse");
    expect(parseRehearsalSlash("/推演 请假系统")).toBe("rehearse");
    expect(parseRehearsalSlash("/精修")).toBe("refine");
    expect(parseRehearsalSlash("/精修 把按钮改红")).toBe("refine");
    expect(parseRehearsalSlash("/质疑")).toBe("challenge");
    expect(parseRehearsalSlash("/范围")).toBe("scope");
    expect(parseRehearsalSlash("/回退")).toBe("restore");
    expect(slashQueryAt("/推演", 3)?.query).toBe("推演");
    expect(filterSlashItems(REHEARSAL_SLASH_ITEMS, "精")[0]?.key).toBe("refine");
    // 反向：https / 日期 / and/or 既不弹面板，也不是推演动词
    expect(parseRehearsalSlash("https://miantuan.ai")).toBeNull();
    expect(parseRehearsalSlash("2026/08/25")).toBeNull();
    expect(parseRehearsalSlash("and/or")).toBeNull();
    expect(slashQueryAt("https://miantuan.ai", 9)).toBeNull();
    expect(slashQueryAt("2026/08/25", 7)).toBeNull();
    expect(slashQueryAt("and/or", 6)).toBeNull();
    expect(REHEARSAL_SLASH_ITEMS.every(i => i.kind === "rehearsal")).toBe(true);
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.name)).toEqual([
      "推演",
      "精修",
      "质疑",
      "计划",
      "回退",
    ]);
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.key)).not.toContain("plan");
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.key)).not.toContain("compact");
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.key)).not.toContain("yolo");
  });

  it("/推演 不得映射成 forcedTool rehearse；精修/质疑/范围/回退各走自己的闸", () => {
    expect(forcedToolForRehearsalVerb("rehearse")).toBeUndefined();
    expect(forcedToolForRehearsalVerb("refine")).toBe("refine");
    expect(forcedToolForRehearsalVerb("challenge")).toBe("challenge");
    expect(forcedToolForRehearsalVerb("scope")).toBe("enter_plan_mode");
    expect(forcedToolForRehearsalVerb("restore")).toBe("restore_version");
    expect(forcedToolForRehearsalVerb(null)).toBeUndefined();
    // 反向：把 rehearse 映射回去，这条必红（空会话会 yolo 点火）
    expect(forcedToolForRehearsalVerb(parseRehearsalSlash("/推演"))).not.toBe(
      "rehearse"
    );
  });

  it("选中推演动词是补全命令，不是摘成芯片名", () => {
    const text = "/精";
    const q = slashQueryAt(text, text.length)!;
    const item = REHEARSAL_SLASH_ITEMS.find(i => i.key === "refine")!;
    const r = applyRehearsalSlashPick(text, q, item);
    expect(r.text).toBe("/精修 ");
    expect(r.text.startsWith("/")).toBe(true);
    const stripped = applySlashPick(text, q);
    expect(stripped.text).not.toContain("精修");
  });

  it("选中后光标离开斜杠段，面板不得再认这段查询", () => {
    const item = REHEARSAL_SLASH_ITEMS.find(i => i.key === "scope")!;
    const r = applyRehearsalSlashPick("/", slashQueryAt("/", 1)!, item);
    expect(r.text).toBe("/计划 ");
    expect(slashQueryAt(r.text, r.caret)).toBeNull();
    // 反向：补全停在词上，onSelect 会把面板叫回来，人要点第二次
    expect(slashQueryAt("/计划", 3)).not.toBeNull();
  });

  it("/范围 POST 余量或当前 goal，卡标题不得等于斜杠令牌", () => {
    expect(rehearsalSlashRemainder("/范围")).toBe("");
    expect(rehearsalSlashRemainder("/范围 考勤系统")).toBe("考勤系统");
    expect(controlUserTextForSlash("/范围", "请假系统")).toBe("请假系统");
    expect(controlUserTextForSlash("/范围 考勤系统", "请假系统")).toBe(
      "考勤系统"
    );
    expect(controlUserTextForSlash("/推演", "请假系统")).toBe("/推演");
  });







  it("面板只推销计划：工厂四字不进可见池，手打目录仍在", () => {
    expect(visibleComposerRehearsalItems().map(i => i.name)).toEqual(["计划"]);
    expect(visibleComposerRehearsalItems().map(i => i.key)).toEqual(["scope"]);
    expect(COMPOSER_SLASH_REHEARSAL_ITEMS).toEqual(visibleComposerRehearsalItems());
    // 反向：把整份目录塞回去，空会话又会冒出推演/精修
    expect(visibleComposerRehearsalItems().map(i => i.name)).not.toContain("推演");
    expect(visibleComposerRehearsalItems().map(i => i.name)).not.toContain("精修");
    expect(visibleComposerRehearsalItems().map(i => i.name)).not.toContain("质疑");
    expect(visibleComposerRehearsalItems().map(i => i.name)).not.toContain("回退");
    expect(filterSlashItems(visibleComposerRehearsalItems(), "精")).toEqual([]);
    // 手打闸没拆：目录里还有精修，parse 仍认
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.name)).toContain("精修");
    expect(REHEARSAL_SLASH_ITEMS.map(i => i.name)).toContain("推演");
  });

  it("已装技能进斜杠池；没装的不进", () => {
    const items = installedSkillSlashItems([
      {
        slug: "office-skills",
        name: "office-skills",
        description: "做 PPT / Word / Excel",
        installed: true,
      },
      {
        slug: "ghost",
        name: "ghost",
        description: "没装",
        installed: false,
      },
    ]);
    expect(items.map(item => item.key)).toEqual(["office-skills"]);
    expect(items[0]?.kind).toBe("skill");
    expect(filterSlashItems(items, "ppt")[0]?.key).toBe("office-skills");
    expect(installedSkillSlashItems([])).toEqual([]);
  });

  it("选中技能是留下 @slug，不是摘成空芯片", () => {
    const item = {
      key: "office-skills",
      kind: "skill" as const,
      name: "office-skills",
      description: "做 PPT",
    };
    const r = applySkillSlashPick(
      "/off",
      slashQueryAt("/off", 4)!,
      item
    );
    expect(r.text).toBe("@office-skills ");
    expect(r.text.startsWith("@")).toBe(true);
    expect(slashQueryAt(r.text, r.caret)).toBeNull();
    const stripped = applySlashPick("/off", slashQueryAt("/off", 4)!);
    expect(stripped.text).not.toContain("office-skills");
  });

  it("正文 @slug 才是这一轮点名；商店勾选存档不算", () => {
    expect(
      mentionedSkillSlugs("@office-skills 做个5页PPT", ["office-skills"])
    ).toEqual(["office-skills"]);
    expect(
      mentionedSkillSlugs("用 @office-skills 和 @frontend-design", [
        "office-skills",
        "frontend-design",
      ])
    ).toEqual(["office-skills", "frontend-design"]);
    expect(mentionedSkillSlugs("npm@2.0 升级", ["office-skills"])).toEqual([]);
    expect(mentionedSkillSlugs("做个PPT", ["office-skills"])).toEqual([]);
    expect(
      mentionedSkillSlugs("@ghost 做ppt", ["office-skills"])
    ).toEqual([]);
  });

  it("新工厂动词默认不进面板——只认 scope，不认「不是工厂的都留下」", () => {
    const extra: SlashItem = {
      key: "yolo",
      kind: "rehearsal",
      name: "狂奔",
      description: "不该出现在面板",
    };
    expect(
      visibleComposerRehearsalItems([...REHEARSAL_SLASH_ITEMS, extra]).map(
        i => i.key
      )
    ).toEqual(["scope"]);
  });

  it("计划支持 /plan 别名，其余 CLI 命令仍不接受", () => {
    expect(parseRehearsalSlash("/plan")).toBe("scope");
    expect(parseRehearsalSlash("/计划")).toBe("scope");
    expect(parseRehearsalSlash("/compact")).toBeNull();
    expect(parseRehearsalSlash("/run")).toBeNull();
    expect(parseRehearsalSlash("/yolo")).toBeNull();
    expect(parseRehearsalSlash("/mcp")).toBeNull();
    expect(parseRehearsalSlash("/commit")).toBeNull();
    expect(parseRehearsalSlash("/loop")).toBeNull();
  });
});
