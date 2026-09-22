"""第 1.5 步：spec → 这个应用的**设计语言**（风格那一半，注进第 3 步的槽位）。

## 这一步为什么存在

链路原来是「起草规格」直接跳到「逐页画界面」，中间没有"这个应用长什么样"
的环节——于是不管什么业务，出来的都是同一个模子。参照的那批企业级后台
真实产品之所以各有各的样子，是因为每个产品**先定了自己的设计语言**。

## 契约不在这里，这里只出风格

`spec_page_html` 已经把设计系统劈成两半：结构契约由代码拼死（<aside>/<header>/
面包屑/脚本不执行…下游全靠它），**风格**才是可注入的那一半。本模块产出的
就是风格那一半，最终渲染成一段散文塞进 `design_system` 槽位。

⚠ 所以这里**永远不该**出现 <aside>、面包屑、Tailwind 这类词。LLM 一句
  「去掉侧边导航」就能让 page_shell 抠不到壳，而整套外壳判据会静默全绿
  （2026-08-15 当天栽过两次同型）。契约压根不经过这里，也就没机会被写坏。

## LLM 只做判断，格式由代码保证

模型给的是**好判断的东西**：hex 颜色、枚举档位、组件名。DTCG 那种
`{"colorSpace":"srgb","components":[0.15,0.39,0.92],"alpha":1,"hex":"#2563eb"}`
不让它写——归一化浮点与 hex 必须自洽，模型写错了没人拦得住，而这种错
不会报警，只会让颜色悄悄偏掉。要标准格式就由 `to_dtcg()` 从 hex 算出来。

（DTCG = W3C Design Tokens Format Module 2025.10，2025-10-28 出的第一个稳定版，
Figma / Penpot / Style Dictionary 都已支持。用它是为了这份产物能被别的工具吃，
不是为了自己好看。）

## 三层覆盖，人写的永远赢

    design_system="..."   人直接给散文   → 整块用它，**不调 LLM**
    design_language={...} 人给结构化字段 → 盖在生成结果上（逐字段）
    都不给                                → 生成一份

## ⚠ fail-open

生成挂了回落到缺省风格，**不打死整轮**。风格不对顶多难看，而整轮挂掉
是把前面几分钟的 spec 一起烧了。这跟 spec_tree 那条"失败不回落占位"不矛盾:
那份回落的是**内容**（假需求树会骗过下游），这里回落的是**审美**。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

DESIGN_LANGUAGE_VERSION = "design-language-v1"

#: 版式原型。封闭词表——开放词表等于没有词表，模型每轮发明一个新词，
#: 下游没法据此做任何事。词少而稳，比多而飘有用。
LAYOUT_ARCHETYPES = ("看板", "工作台", "台账", "表单", "详情")

#: 密度档位。三档就够，再细模型自己也分不清。
DENSITIES = ("紧凑", "标准", "宽松")

#: 档位 → **具体条款**。这一层由代码展开，不问模型。
#:
#: ## ⚠ 为什么必须展开（2026-08-15 晚，两次对照量出来的）
#:
#: 只把「信息密度标准」四个字塞进提示词，模型能推出的动作很有限。实测：
#:
#:     A 旧提示词（一句话）                 字符 16892/页  面板 16.7  右侧栏 0/3
#:     B 硬写死密度条款（统计卡/面板/列数）  字符 25838/页  面板 22.3  右侧栏 3/3
#:     C 换成生成的设计语言（只给档位词）    字符 18748/页  面板 17.8  右侧栏 0/4
#:
#: B 涨的那 53% 全来自**具体条款**，不是来自"密度"这个词。C 把条款撤了、
#: 只留档位词，密度就掉回去了。
#:
#: 所以分工是：**档位是模型的判断，档位具体意味着什么是代码的事**——
#: 跟 DTCG 那条同源（模型给 hex，分量由代码算）。这样既不写死风格
#: （模型仍可选紧凑/标准/宽松，甚至由人覆盖），又不让"密度"变成一句空话。
_DENSITY_RULES = {
    "紧凑": (
        "顶部一组统计卡（4~6 个），每个卡有指标名、大号数值、单位，"
        "以及同比/环比或状态说明这类第二行小字。"
        "主区至少 4 个信息面板，每个面板有标题栏，标题栏右侧放该面板自己的操作。"
        "主表格至少 8 列，带行内状态标签、行内操作列、表头，以及分页或「共 N 条」统计。"
        "字号偏小、行高偏紧，一屏要能看到尽量多的行。"
    ),
    "标准": (
        "顶部一组统计卡（3~5 个），每个卡有指标名、大号数值、单位，"
        "以及同比/环比或状态说明这类第二行小字。"
        "主区至少 3 个信息面板，每个面板有标题栏，标题栏右侧放该面板自己的操作。"
        "主表格至少 6 列，带行内状态标签、行内操作列、表头，以及分页或「共 N 条」统计。"
        "该有筛选区就写筛选区（日期范围、下拉、搜索框、重置按钮排成一行）。"
    ),
    "宽松": (
        "顶部一组统计卡（3 个左右）。主区 2~3 个信息面板，每个面板有标题栏。"
        "主表格 5 列上下，留白多一些，字号和行高都偏大。"
    ),
}

#: 手机密度。桌面那套写「主表格 6~8 列 / 筛选排成一行 / 右侧栏」——
#: 2026-08-20 真机：画页契约已经是竖屏单列，风格段仍在点名宽表和右侧栏，
#: 出来的就是「底栏 + 宽屏工作台」。条款必须跟契约同一套信息架构。
_DENSITY_RULES_PHONE = {
    "紧凑": (
        "顶部 3~4 张指标卡（两列）。主区单列卡片流。"
        "列表每行一条：标题、状态、日期，不要 6 列以上的宽表。"
        "不要左右分栏，不要右侧详情栏。"
    ),
    "标准": (
        "顶部 2~3 张指标卡。主区单列：列表卡片或一张主表单。"
        "触控行高够大。列表和填写拆开，不要一屏左右两栏。"
        "不要 6 列以上的宽表，不要右侧详情栏。"
    ),
    "宽松": (
        "少卡片、大字号、单列。一屏一件主任务。"
        "不要左右分栏，不要右侧详情栏。"
    ),
}

#: 平板密度。2026-08-30 夜：style brief 仍点名「主表几列 / 右侧详情栏」，
#: 画页契约已经是 1112 两栏，风格段把现场手持又画回 1920 中台。
#: 条款必须跟契约同一套信息架构——两栏 + 窄侧栏，不是手机单列，也不是桌面宽表。
_DENSITY_RULES_TABLET = {
    "紧凑": (
        "窄侧栏（w-52）。主区两栏：主任务 + 可折叠旁路详情。"
        "表格最多 5 列，其余字段进详情。不要 8 列宽表，不要永久占着的右侧详情栏。"
        "不要手机底栏，不要单列卡片流顶替主表。"
    ),
    "标准": (
        "窄侧栏（w-52）。主区两栏，旁路详情可收。"
        "表格最多 5 列。筛选用顶部 chip，不要左侧筛选面板。"
        "不要 1920 工作台的多列表格，不要手机那种单列底栏。"
    ),
    "宽松": (
        "留白多一些，仍是两栏不要三栏。侧栏保持 w-52。"
        "表格 4 列上下。不要桌面那种多列宽表加永久第三列。"
    ),
}

#: 消费 / 内容应用的密度。后台那套「统计卡 / 主表几列」会把杂志画成中台。
_DENSITY_RULES_CONTENT = {
    "紧凑": (
        "封面或图流占满第一屏。大幅配图 + 短标题 + 一条主操作。"
        "不要统计卡，不要宽表，不要侧栏台账。"
    ),
    "标准": (
        "图是一等公民。封面大图、图流卡片、详情长文配图。"
        "不要 KPI 四宫格，不要后台宽表。"
    ),
    "宽松": (
        "留白多、字号大、一张主图。一屏一件内容。"
        "不要后台密度，不要四张等宽指标卡。"
    ),
}

#: 自由类型密度。内容那套「一张主图」会把图流收成半空货架
#: （2026-08-31 团子的一天 / 街拍图流、漫游作者）。后台那套 KPI
#: 又会把同一题画成中台。按这一页的活儿展开，不写死页型。
_DENSITY_RULES_FREE = {
    "紧凑": (
        "一屏放得下这一页的主货。图流/货架至少 4 张可见图，不要一张主图顶替货架。"
        "不要统计卡四宫格，不要宽表，不要侧栏台账。"
    ),
    "标准": (
        "按这一页的活儿：封面/长文可以一张主图，图流/档案至少 4~6 张可见图，"
        "表单就一个主表单。不要 KPI 四宫格，不要为了凑杂志硬切四页。"
    ),
    "宽松": (
        "留白可以多、字号可以大，但图流/档案不要空成半屏。"
        "封面/长文可以一张主图。不要后台密度，不要四张等宽指标卡。"
    ),
}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

#: 2026-08-31：没选设计系统时也要落到一个点。选了才走
#: `design_system_constraint`；没选原先只让模型写 80~150 字形容词，
#: 会议室预约也会长成 Inter + #2563eb + 四张等宽 KPI。
#:
#: 官方 PHILOSOPHY（DESIGN.md）：Adjectives describe a region.
#: A specific reference describes a point.
#:
#: ⚠ 参照只取气质，不取落地页结构。写「去掉侧栏 / 满幅摄影」会跟
#: 桌面契约打架——08-15 真机栽过，外壳判据还全绿。
_TASTE_DISCIPLINE = (
    "气质必须落到一个具体参照（某个真实产品、场所或物件的样子），"
    "不要只堆「现代、专业、简洁、科技感」这种形容词。"
    "不要用 Inter + 紫渐变 + 玻璃拟态，也不要把 #2563eb 当没想好时的退路。"
    "参照只取色、字、疏密、圆角；这是给人干活的产品界面，不是营销落地页。"
)

#: 缺省设计语言。**没人指定时的兜底**，不是"推荐配置"。
DEFAULT_DESIGN_LANGUAGE: Dict[str, Any] = {
    "version": DESIGN_LANGUAGE_VERSION,
    "tone": "企业后台风格，浅色底",
    "primary": "#2563eb",
    "accent": "#0f172a",
    "radius": "8px",
    "density": "标准",
    "components": [],
    "charts": False,
}


def _clean_str(v: Any, limit: int) -> str:
    return " ".join(str(v or "").split())[:limit]


def normalize_design_language(raw: Any) -> Dict[str, Any]:
    """把模型给的东西收进封闭形状。**不合规的字段丢掉换缺省，不抛。**

    ⚠ 逐字段兜底而不是整份丢：模型常常九个字段对、一个字段瞎写，
      整份丢等于把对的那九个也扔了。
    """
    src = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_DESIGN_LANGUAGE)

    tone = _clean_str(src.get("tone"), 60)
    if tone:
        out["tone"] = tone

    for key in ("primary", "accent"):
        val = _clean_str(src.get(key), 7)
        if _HEX.match(val):
            out[key] = val.lower()

    radius = _clean_str(src.get("radius"), 12)
    if re.match(r"^\d{1,2}px$", radius):
        out["radius"] = radius

    if src.get("density") in DENSITIES:
        out["density"] = src["density"]

    comps = src.get("components")
    if isinstance(comps, list):
        seen: List[str] = []
        for c in comps:
            name = _clean_str(c, 12)
            if name and name not in seen:
                seen.append(name)
        out["components"] = seen[:8]

    out["charts"] = bool(src.get("charts"))
    return out


def merge_override(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """人写的字段盖在生成结果上。**只盖给出来的那几个**。

    ⚠ 不做深合并：这份结构是平的，深合并只会在"空列表算不算覆盖"这种
      问题上产生分歧。给了就盖，没给就留着。
    """
    if not isinstance(override, dict) or not override:
        return dict(base)
    out = dict(base)
    for k, v in override.items():
        if v is None:
            continue
        out[k] = v
    return normalize_design_language(out)


def render_design_language(
    dl: Optional[Dict[str, Any]], *, device: str = "desktop", product_archetype: str = ""
) -> str:
    """设计语言 → 塞进 `design_system` 槽位的那段散文。**纯函数，零 LLM。**

    ⚠ 由代码渲染而不是让模型直接写散文：这样覆盖才能是**逐字段**的，
      而且同一份输入永远渲染出同一段话（模型写散文每次都不一样，
      等于同一个应用两次生成两种样子）。
    """
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)
    bits = [f"{d['tone']}。"]
    bits.append(f"主色 {d['primary']}，强调色 {d['accent']}，圆角 {d['radius']}。")
    # ⚠ 档位要**展开成具体条款**再进提示词：只写"信息密度标准"四个字，
    #   模型推不出该画几个统计卡、几个面板、表格几列——实测密度会掉回去。
    #   见 _DENSITY_RULES 头上那三行对照数据。
    # ⚠ 2026-08-20：phone 不能复用「这是后台」那句——那一句会把竖屏契约
    #   又画回宽表工作台。条款换 _DENSITY_RULES_PHONE，主语换成手机 App。
    # ⚠ 2026-08-30：tablet 也不能复用那句——「主表几列 / 右侧详情栏」会把
    #   1112 现场手持画回 1920 中台。不许写成 `phone else desktop`。
    from .archetype_legal import is_content_app, is_free_app

    if is_content_app(product_archetype):
        extra = _DENSITY_RULES_CONTENT[d["density"]]
        if device == "phone":
            bits.append(
                f"这是手机竖屏内容应用，不是 PC 后台。图是一等公民。"
                f"{_DENSITY_RULES_PHONE[d['density']]}{extra}"
            )
        else:
            bits.append(
                f"这是给人看和读的内容产品，不是业务后台。{extra}"
            )
    elif is_free_app(product_archetype):
        extra = _DENSITY_RULES_FREE[d["density"]]
        if device == "phone":
            bits.append(
                f"这是手机竖屏自由类型，不是 PC 后台。"
                f"{_DENSITY_RULES_PHONE[d['density']]}{extra}"
            )
        else:
            bits.append(
                f"这是自由类型：不套后台中台，也不套杂志四页。{extra}"
            )
    elif device == "phone":
        bits.append(
            f"这是手机竖屏 App，不是 PC 后台。{_DENSITY_RULES_PHONE[d['density']]}"
        )
    elif device == "tablet":
        bits.append(
            f"这是平板横屏现场作业（1112×834），不是 PC 中台，也不是竖屏手机。"
            f"{_DENSITY_RULES_TABLET[d['density']]}"
        )
    else:
        bits.append(
            f"这是给天天用它干活的人看的后台，不是落地页。{_DENSITY_RULES[d['density']]}"
        )
    if d["components"]:
        bits.append("按内容需要用这些组件（不要硬凑）：" + "、".join(d["components"]) + "。")
    if d["charts"]:
        bits.append("这类页面适合配图表，用内联 SVG 画出坐标轴与图例。")
    return "\n".join(bits)


def build_design_language_prompt(
    spec: Dict[str, Any], *, device: str = "desktop", product_archetype: str = ""
) -> List[Dict[str, str]]:
    """按 spec 问一次「这个应用该长什么样」。

    只喂**页面清单与用途**，不喂整棵需求树：定风格要的是"这是个什么应用"，
    倒整棵树进去既贵又会把模型注意力拖到细节上。
    """
    pages = [
        f"- {p.get('name', '')}：{p.get('purpose', '') or p.get('audience', '')}"
        for p in (spec.get("pages") or [])
        if isinstance(p, dict)
    ]
    app = _clean_str(spec.get("appName"), 40)
    from .archetype_legal import is_content_app, is_free_app

    content = is_content_app(product_archetype)
    free = is_free_app(product_archetype)
    if content:
        # ⚠ 必须先于 phone/tablet 枝：否则 content+phone 会领走「医疗移动应用」，
        #   杂志封面被画成后台 App。跟 style_brief 同一分叉顺序。
        if device == "phone":
            role = "你是资深移动端视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = (
                "这是手机竖屏内容应用，不是 PC 后台。图是一等公民。"
                "基调按封面/图流来，不要写成桌面管理系统。\n\n"
            )
            tone_ex = "「像一本独立杂志的手机封面，浅色底，大幅配图」"
        elif device == "tablet":
            role = "你是资深消费端视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = (
                "这是平板上给人看和读的内容产品，不是巡店后台。"
                "图是一等公民，不要 w-52 侧栏台账。\n\n"
            )
            tone_ex = "「像一本独立杂志的横屏内页，浅色底，大幅配图」"
        else:
            role = "你是资深消费端视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = "这是给人看和读的内容产品，不是业务后台。图是一等公民。\n\n"
            tone_ex = "「像一本独立杂志的封面和内页，浅色底，大幅配图」"
    elif free:
        if device == "phone":
            role = "你是资深移动端视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = (
                "这是手机竖屏自由类型，不是 PC 后台。"
                "按这一页的活儿定基调，不要写成桌面管理系统，也不要硬套杂志封面。\n\n"
            )
            tone_ex = "「按这个产品自己的气质，浅色底，该大图就大图」"
        elif device == "tablet":
            role = "你是资深产品视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = (
                "这是平板上的自由类型，不是巡店后台，也不是杂志四页。"
                "按这一页的活儿定基调，不要 w-52 侧栏台账。\n\n"
            )
            tone_ex = "「按这个产品自己的气质，浅色底，该大图就大图」"
        else:
            role = "你是资深产品视觉设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
            extra = (
                "这是自由类型：不套后台中台，也不套杂志四页。"
                "按这一页的活儿定基调。\n\n"
            )
            tone_ex = "「按这个产品自己的气质，浅色底，该大图就大图」"
    elif device == "phone":
        role = "你是资深移动端产品设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
        extra = "这是手机竖屏 App，不是 PC 后台。基调按移动应用来，不要写成桌面管理系统。\n\n"
        tone_ex = "「清爽的医疗移动应用，浅色底，大触控」"
    elif device == "tablet":
        role = "你是资深平板端产品设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
        extra = (
            "这是平板横屏现场作业（1112×834），不是 PC 中台，也不是竖屏手机。"
            "基调按巡店/点单这种手持平板场景来，不要写成 1920 工作台。\n\n"
        )
        tone_ex = "「清爽的巡店平板，浅色底，大触控，两栏不要三栏」"
    else:
        role = "你是资深 B 端产品设计师。看一眼这个应用是干什么的，定下它的视觉风格。"
        extra = ""
        tone_ex = "「像县域农技站的纸质台账搬上屏，浅色底，弱化装饰」"
    body = (
        f"应用名：{app or '（未命名）'}\n"
        f"页面清单：\n" + ("\n".join(pages[:12]) or "（空）")
    )
    return [
        {
            "role": "system",
            "content": (
                f"{role}"
                "只谈风格，不要谈页面结构或具体标签。只返回 JSON。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"{extra}{body}\n\n"
                "按这个形状返回 JSON：\n"
                "{\n"
                f'  "tone": "一句话风格基调，30 字以内，例如{tone_ex}",\n'
                f'  "primary": "主色 hex，形如 #2563eb",\n'
                f'  "accent": "强调色 hex",\n'
                '  "radius": "圆角，形如 8px",\n'
                f'  "density": "信息密度，只能是 {"/".join(DENSITIES)} 之一",\n'
                '  "components": ["这个应用用得上的组件名，3~6 个，例如 状态标签、进度条、时间线"],\n'
                '  "charts": true 或 false（这个应用是否适合配图表）\n'
                "}\n\n"
                f"{_TASTE_DISCIPLINE}"
                f"{experience_skill_constraint()}"
                "颜色要贴合业务气质（医疗偏冷静、金融偏稳重、工具偏中性），"
                "不要用高饱和撞色。只返回 JSON，不要解释。"
            ),
        },
    ]


def generate_design_language(
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Any] = None,
    override: Optional[Dict[str, Any]] = None,
    device: str = "desktop",
    product_archetype: str = "",
) -> Dict[str, Any]:
    """生成这个应用的设计语言。**挂了回落缺省，不抛。**

    ⚠ fail-open 的理由见模块头：这一步产出的是审美，不是内容。
      挂掉就用缺省风格接着画，比把整轮打死好。
    """
    from .spec_llm_call import call_spec_json

    dl = dict(DEFAULT_DESIGN_LANGUAGE)
    try:
        outcome = call_spec_json(
            build_design_language_prompt(
                spec, device=device, product_archetype=product_archetype
            ),
            llm_json_fn,
            stage="specfirst.design",
        )
        if outcome.payload is not None:
            dl = normalize_design_language(outcome.payload)
        else:
            print(f"[design_language] 生成失败，用缺省风格：{outcome.failure}")
    except Exception as exc:  # noqa: BLE001 — 审美挂了不该打死整轮
        print(f"[design_language] 生成抛错，用缺省风格：{str(exc)[:200]}")
    return merge_override(dl, override)


def to_dtcg(dl: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """渲染成 W3C Design Tokens Format 2025.10 的形状。

    ⚠ 由**代码**从 hex 算出 components/alpha，不让模型写：那三个数跟 hex
      必须自洽，模型写偏了不会有任何一处报警，颜色只是悄悄不对。

    颜色值形状照规范：{"colorSpace":"srgb","components":[r,g,b],"alpha":1,"hex":"#.."}
    尺寸值形状照规范：{"value":8,"unit":"px"}
    """
    d = normalize_design_language(dl or DEFAULT_DESIGN_LANGUAGE)

    def color(hex_str: str) -> Dict[str, Any]:
        h = hex_str.lstrip("#")
        comps = [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]
        return {
            "colorSpace": "srgb",
            "components": comps,
            "alpha": 1,
            "hex": f"#{h.lower()}",
        }

    return {
        "color": {
            "$type": "color",
            "primary": {"$value": color(d["primary"])},
            "accent": {"$value": color(d["accent"])},
        },
        "radius": {
            "$type": "dimension",
            "base": {"$value": {"value": int(d["radius"][:-2]), "unit": "px"}},
        },
    }


# ── 风格段改由 LLM 现写（2026-08-16）─────────────────────────────────
#
# ## 为什么换掉确定性渲染
#
# 用户裁决：「a 就算内容再多也是写死的」。上面那套 render_design_language
# 是**代码写句式、模型填字段**——密度条款、组件那句、图表那句，措辞全是常量，
# 换哪个业务都是同一段话。实测两个完全不同业务的最终提示词逐字相同 92.8%。
#
# 对照实验（同一份 spec 两臂，唯一变量是这一段）：
#
#     跨业务相同度   确定性 92.8%   LLM 现写 81.7%   ← 后者是唯一越过 87% 那条
#                                                     历史基准线的
#     面板/页        21.3          15.8
#     交互控件/页    18.0           9.0
#
# 多样性是真的，密度腰斩也是真的。**但密度那一半是实现缺陷，不是路线代价**：
# 那次 B 臂的风格段是**应用级**的，而模型自发写成了逐页版式计划——于是
# p1 的提示词里塞着 p2/p3/p4 该怎么排。所以这里改成**一次调用出两层**：
#
#     app    应用级基调（配色、圆角、气质）——全应用共用，页面才像同一个产品
#     pages  逐页版式计划——每页只拿自己那份
#
# ⚠ 仍然一个字都不写死：密度、组件、图表用不用，全由模型自己定。
#   代码只负责"把它的判断准确地送到该去的地方"。
#
# ⚠ 确定性那套**不删**：它是这一步挂掉时的回落。审美挂了不该打死整轮。

STYLE_BRIEF_VERSION = "style-brief-v1"

#: 结构词。风格段里出现它们就是在碰契约——模型一句"去掉侧边导航"能让
#: page_shell 抠不到壳，而整套外壳判据会静默全绿（2026-08-15 栽过两次）。
#: ⚠ 契约本来就压在风格段后面且写明"冲突时以这一节为准"，所以这里**只清洗
#:   不失败**：为一句措辞把整页打掉，代价比留着大。
_STRUCTURAL_WORDS = (
    "<aside", "aside>", "侧边栏", "侧栏", "面包屑", "breadcrumb", "Breadcrumb",
    "<header", "<main", "<nav", "Tailwind", "tailwind", "<script",
)


def _scrub(text: str, limit: int) -> str:
    """去掉结构词所在的那一句，其余保留。"""
    out = []
    for seg in re.split(r"(?<=[。；;.\n])", " ".join(str(text or "").split())):
        if seg and not any(w in seg for w in _STRUCTURAL_WORDS):
            out.append(seg)
    return "".join(out).strip()[:limit]


def normalize_style_brief(raw: Any, page_ids: List[str]) -> Dict[str, Any]:
    """收进封闭形状。**逐字段兜底，不整份丢。**"""
    src = raw if isinstance(raw, dict) else {}
    pages_src = src.get("pages") if isinstance(src.get("pages"), dict) else {}
    pages = {}
    for pid in page_ids:
        got = _scrub(pages_src.get(pid), 400)
        if got:
            pages[pid] = got
    return {
        "version": STYLE_BRIEF_VERSION,
        "app": _scrub(src.get("app"), 300),
        "pages": pages,
    }


def style_brief_ok(brief: Optional[Dict[str, Any]], page_ids: List[str]) -> bool:
    """够不够用。**应用级基调必须有**，逐页计划缺几页可以容忍（那几页退回只用基调）。"""
    if not isinstance(brief, dict) or not str(brief.get("app") or "").strip():
        return False
    return bool(brief.get("pages"))


def style_for_page(brief: Optional[Dict[str, Any]], page_id: str) -> str:
    """拼出**这一页**的风格段：应用级基调 + 它自己那份版式计划。

    ⚠ 只给自己那份。B 臂那次把四页的计划一起塞进每一页，是密度腰斩的主因。
    """
    if not isinstance(brief, dict):
        return ""
    bits = [str(brief.get("app") or "").strip()]
    own = str((brief.get("pages") or {}).get(page_id) or "").strip()
    if own:
        bits.append(own)
    return "\n".join(b for b in bits if b)



# --- 用户选定的设计系统 → 风格段约束（2026-08-24）--------------------------


def active_design_system() -> Optional[Dict[str, Any]]:
    """本轮用户选的那套设计系统。没选返回 None（走原来的"LLM 自己定色"）。"""
    from .identity_palette_hint import _design_system_override

    return _design_system_override


def design_system_constraint(system: Optional[Dict[str, Any]]) -> str:
    """设计系统 → 塞进风格段提示词的一段约束。**纯函数，零 LLM。**

    ## ⚠ 为什么只给这几行，不把整份 DESIGN.md 倒进去

    2026-08-19 的教训就写在 spec_first_pipeline 第 1420 行上方：接过
    ui-ux-pro-max 的 CSV 查表，色板被当成整页墙纸、跟桌面契约打架，用户裁决
    卸掉，并留下「别再把上游 CSV 倒进画页提示词」。整份 DESIGN.md 有 60+ 行
    token，倒进去是同一个错误的另一种形状。

    所以这里只取**模型猜不出来的那部分**：
      · reference —— 一个具体参照。DESIGN.md 官方 PHILOSOPHY 的原话是
        「Adjectives describe a region. A specific reference describes a point.」
        「低饱和绿、适合养护业务」这种形容词堆让模型落在词义中心，出来的东西
        必然平庸；「县域农技站的纸质台账搬上屏」直接指向一个点。
      · 三个色值 + 圆角 —— 已经定死的事实，不是建议。
      · donts —— 负向约束。官方 PHILOSOPHY：「What you leave out defines
        the character」。

    ## ⚠ 注入位置

    进的是**风格段那一次应用级调用**（一轮一次），不是逐页画页提示词
    （一轮 N 次）。画页那层已经有结构契约，再塞一份风格文档只会打架。

    ## ⚠ 措辞必须是"已经定了"，不能是"建议用"

    原提示词让模型自己写「主色 hex、强调色 hex、圆角」。不把这三样明确改成
    既定事实，模型会照旧发明一套——选择器就又变成装饰了。
    """
    if not system:
        return ""
    donts = system.get("donts") or []
    dont_lines = "".join(f"\n- 不要{d.lstrip('不要')}" for d in donts)
    return (
        f"\n\n【设计系统：{system.get('label','')}】用户已经为这个应用选定了设计系统，"
        f"下面这些**是既定事实，不是建议**，你不要再自己发明配色和圆角：\n"
        f"- 参照：{system.get('reference','')}\n"
        f"- 主色 {system.get('seed','')}；圆角档 {system.get('radius','md')}；"
        f"{'深色底' if system.get('dark') else '浅色底'}\n"
        f"- 你写的 app 基调里，主色 hex 必须原样写成 {system.get('seed','')}，"
        f"强调色从它派生（同色相的深浅变体），不要引入不搭的新色相。"
        f"{dont_lines}"
    )


def experience_skill_constraint() -> str:
    """已安装的 experience 技能 → 风格段约束。**排版/参照，不当种子色。**

    2026-08-03 把 experience 从 identity_theme 种子色摘掉（全站一色）。
    正确的活路径是风格段（本函数），不是把 SKILL.md 倒进画页，也不是再喂给选色。

    只取 name + 短 description（跟 design_system_constraint 同一纪律）。
    没装返回空串——增强项不改变没装技能时的既有行为。
    """
    try:
        from .turn_context import MAX_INSTALLED_SKILLS, installed_skills_for_channel

        skills = installed_skills_for_channel("experience")
    except Exception:
        return ""
    if not skills:
        return ""
    lines = [
        "\n\n【体验技能】用户装了这些设计技能。它们是排版、层级与气质的参照，"
        "不是配色种子——不要为了它们改主色 hex，也不要把技能原文写进页面。"
    ]
    for s in skills[:MAX_INSTALLED_SKILLS]:
        name = str(s.get("name") or "").strip()
        if not name:
            continue
        desc = " ".join(str(s.get("description") or "").split())[:80]
        lines.append(f"- {name}：{desc}" if desc else f"- {name}")
    if len(lines) == 1:
        return ""
    return "\n".join(lines)


def design_system_override(system: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """设计系统 → design_language 的逐字段覆盖（回落分支用）。

    ⚠ 主路径是 generate_style_brief（2026-08-16 用户裁决改 LLM 现写），
      回落分支才走 design_language。**两条都要接**：只接主路径的话，风格段
      生成挂掉那次会静默回到"LLM/缺省自己定色"，用户选的设计系统当场失效，
      而且不会有任何报错——本仓「只改一半必然静默失效」的标准形状。
    """
    if not system:
        return {}
    radius_px = {"none": "0px", "sm": "4px", "md": "8px", "lg": "16px"}
    return {
        "primary": str(system.get("seed", "")).lower(),
        "radius": radius_px.get(str(system.get("radius") or "md"), "8px"),
        "tone": (str(system.get("reference") or system.get("label") or ""))[:60],
    }


def _assumption_layout_block(spec: Dict[str, Any]) -> str:
    """伴随式决定进风格提示词。空则空串，不留空段。

    跟 spec_page_html.assumption_prompt_block 同一段话。不 import 那边：
    那边会拉 HTML 栈，风格模块只该谈气质。判据盯「家长模式」进了 user 段。
    """
    rows = spec.get("assumptions") if isinstance(spec, dict) else None
    if not isinstance(rows, list) or not rows:
        return ""
    lines = [
        "已确认的产品决定（必须做成看得见的界面：输入框、按钮、开关、列表；",
        "禁止只写在 HTML 注释、角标或空状态说明里）：",
    ]
    for row in rows:
        if not isinstance(row, dict):
            continue
        topic = str(row.get("topic") or "").strip()
        decision = str(row.get("decision") or "").strip()
        if topic and decision:
            lines.append(f"- {topic}：{decision}")
        elif decision:
            lines.append(f"- {decision}")
        elif topic:
            lines.append(f"- {topic}")
    if len(lines) <= 2:
        return ""
    return "\n".join(lines) + "\n"


def build_style_brief_prompt(
    spec: Dict[str, Any], *, device: str = "desktop", product_archetype: str = ""
) -> List[Dict[str, str]]:
    """问一次「这个应用长什么样 + 每一页怎么排」。

    ## ⚠ 逐个点名面板，是量出来的（2026-08-16，同一份 spec 四臂）

        臂                      面板   图表   表格列数   标题   文字量
        A 写死密度条款          21.3   0.3    5.5       4.8    599
        C LLM逐页（只问分几区） 14.5   0.3    3.8       2.5    526
        D C + 逐个点名面板      11.3   1.5    5.3       5.5    546

    D 把**表格列数追回了 A 的水平**（3.8→5.3）、图表翻五倍、标题最多。

    ⚠ 「面板」那一列反而更低，而这是**指标在骗人**：它数的是圆角+边框的容器，
      chip / 徽标 / 内层小盒子全算。A 的密度条款催生大量嵌套小盒子把数刷高了。
      看渲染图：D 的看板每张统计卡里带 sparkline、主图带完整坐标轴、
      右侧环形仪表——视觉信息量不低于 A，只是盒子少。

    ⚠ 明写「不要为了凑数硬加」：D 的销课台只点了 4 个面板（大扫码框 + 会员
      核验卡 + 课包卡 + 流水），而 A 被密度条款催出 25 个。**对一个前台
      销课页，少才是对的**——密度不该是无条件的。
    """
    pages = [p for p in (spec.get("pages") or []) if isinstance(p, dict) and p.get("id")]
    listing = "\n".join(
        f'- {p["id"]}｜{p.get("name","")}：{p.get("purpose","") or p.get("audience","")}'
        for p in pages
    )
    ids = "、".join(str(p["id"]) for p in pages)
    from .archetype_legal import is_content_app, is_free_app

    content = is_content_app(product_archetype)
    free = is_free_app(product_archetype)
    if content:
        designer = (
            "你是资深移动端视觉设计师。"
            if device == "phone"
            else "你是资深消费端视觉设计师。"
        )
        layout_ask = (
            "每页那段必须**把这一页要放的区块逐个点名**，写成清单：每个区块叫什么、"
            "放什么内容、大概占多大。这一页该放几个区块由你按它的活儿定，不要为了凑数硬加。"
            "先判这一页是哪种活（封面、图流、详情、杂志），再点名。"
            "图是一等公民：封面/图流第一眼必须有大幅配图，不要 KPI 统计卡顶替画面。"
            "图流/档案第一屏至少 4 张可见图，不要两列网格只放一张。封面/长文可以一张主图。"
            "不要宽表、不要侧栏台账、不要四张等宽指标卡当首页。"
            "这是给人看、刷、读的内容产品，不是给坐工位办事的后台。"
        )
        if device == "phone":
            layout_ask += (
                "这是手机竖屏：单列、不要左右分栏、不要右侧详情栏。"
                "内容铺满 390×844 视口，不要再套手机外框。"
            )
        elif device == "tablet":
            layout_ask += (
                "这是平板横屏（1112×834）：两栏可以，不要 1920 中台宽表，不要手机底栏。"
            )
    elif free:
        designer = (
            "你是资深移动端视觉设计师。"
            if device == "phone"
            else "你是资深产品视觉设计师。"
        )
        layout_ask = (
            "每页那段必须**把这一页要放的区块逐个点名**，写成清单：每个区块叫什么、"
            "放什么内容、大概占多大。这一页该放几个区块由你按它的活儿定，不要为了凑数硬加。"
            "先判这一页是哪种活（看板、工作台、台账、表单、详情、封面、图流、杂志），再点名。"
            "不要为了凑后台硬加 KPI，也不要为了凑杂志硬切成封面/图流四页。"
            "图流/货架第一屏至少 4 张可见图，不要两列网格只放一张。封面/长文可以一张主图。"
            "头像必须是正方形人像特写，不要把风景或相机裁进小框。"
            "<main> 不要 justify-between 把稀疏区块撑满视口。"
        )
        if device == "phone":
            layout_ask += (
                "这是手机竖屏：单列、不要左右分栏、不要右侧详情栏。"
                "内容铺满 390×844 视口，不要再套手机外框。"
            )
        elif device == "tablet":
            layout_ask += (
                "这是平板横屏（1112×834）：两栏可以，不要 1920 中台宽表，不要手机底栏。"
            )
    elif device == "phone":
        designer = "你是资深移动端产品设计师。"
        layout_ask = (
            "每页那段必须**把这一页要放的区块逐个点名**，写成清单：每个区块叫什么、"
            "放什么内容、大概占多大。这一页该放几个区块由你按它的活儿定——"
            "列表页通常一张指标区 + 一列任务卡，表单页就一个主表单，不要为了凑数硬加。"
            "先判这一页是哪种活。总览才写顶部指标卡几张分别是什么；"
            "列表就是列表，表单就是表单，不要每页都先画一排指标卡。"
            "点名之后再补：主列表是卡片还是行、有没有底部主按钮。"
            "这是手机竖屏 App，不是 PC 后台：单列、不要左右分栏、不要右侧详情栏、不要 6 列以上的宽表。"
            "第一屏是业务列表（卡片/行 + 状态），不要画成个人中心、设置页或退出登录页。"
            "内容铺满 390×844 视口，不要再套手机外框，不要用 max-w-md / mx-auto 把整页收成居中卡片。"
        )
    elif device == "tablet":
        designer = "你是资深平板端产品设计师。"
        layout_ask = (
            "每页那段必须**把这一页要放的区块逐个点名**，写成清单：每个区块叫什么、"
            "放什么内容、大概占多大。这一页该放几个区块由你按它的活儿定——"
            "台账类通常主列 + 旁路详情，扫码核销这类专注操作的页面要得少，不要为了凑数硬加。"
            "先判这一页是哪种活。总览才点指标卡；占用网格、排期不要硬凑统计卡。"
            "点名之后再补：主列放什么、旁路详情放什么、表格不超过 5 列分别是哪些列、"
            "有没有可折叠旁路详情。"
            "这是平板横屏现场作业（1112×834），不是 PC 中台：两栏 + 窄侧栏（w-52），"
            "不要 1920 工作台的多列表格，不要永久占着的第三列详情栏，"
            "不要单列底栏那种竖屏切页。"
        )
    else:
        designer = "你是资深 B 端产品设计师。"
        layout_ask = (
            "每页那段必须**把这一页要放的面板逐个点名**，写成清单：每个面板叫什么、"
            "放什么内容、大概占多大。这一页该放几个面板由你按它的活儿定——"
            "台账类通常要得多，扫码核销这类专注操作的页面要得少，不要为了凑数硬加。"
            "先判这一页是哪种活（看板、工作台、台账、表单、详情），再点名。"
            "总览/看板才点统计卡几张分别是什么指标；"
            "占用网格、日历、排期这类工作台按格子/时间轴点名，不要硬凑统计卡和宽表；"
            "表单页就一个主表单；详情页按字段分组。"
            "有主表的台账才写列名和要不要旁路详情；没有就别写。"
        )
    return [
        {"role": "system", "content": (
            f"{designer}给这个应用定视觉风格，并为每一页定版式计划。"
            "**只谈风格与版面**：气质基调、配色、圆角、字号、一屏放多少东西、"
            "用哪些组件、要不要图表、各区怎么分。"
            "**不要提任何 HTML 标签，不要提侧边导航/面包屑这类外壳结构，不要提技术栈**"
            "——那些由另一套约束负责，你写了会打架。只返回 JSON。"
            f"{_TASTE_DISCIPLINE}"
            # ⚠ 接在 system 段尾：这是一轮一次的应用级调用，不是逐页那 N 次。
            #   没选设计系统时 constraint 仍是空串；参照纪律在上面那句，
            #   不再靠「提示词与改动前逐字相同」冻住默认路。
            + design_system_constraint(active_design_system())
            + experience_skill_constraint()
        )},
        {"role": "user", "content": (
            f"应用名：{_clean_str(spec.get('appName'), 40) or '（未命名）'}\n"
            f"页面清单：\n{listing}\n"
            f"{_assumption_layout_block(spec)}"
            "\n返回 JSON：\n"
            '{\n'
            '  "app": "应用级基调，80~150 字：具体参照（像哪个产品/场所）、'
            '气质、主色 hex、强调色 hex、圆角、字号密度。'
            '这一段全应用共用，页面才像同一个产品。",\n'
            f'  "pages": {{ 每个页面 id 一段版式计划，200~350 字（id 是：{ids}）}}\n'
            '}\n\n'
            # ★ 逐个点名（2026-08-16 对照实验落地）：只问"分几个区"时模型给的是
            #   笼统描述；逼它把面板写成清单之后，表格列数从 3.8 回到 5.3、
            #   图表 0.3→1.5、标题 2.5→5.5。见函数 docstring 里的四臂数据。
            # ⚠ 2026-08-20：phone 不能再点名「主表几列 / 右侧详情栏」，那就是
            #   把 PC 工作台写进风格段。
            # ⚠ 2026-08-31：桌面也不能无条件点名统计卡/宽表——会议室占用网格
            #   会被画成 KPI 中台。先判页型，总览才点统计卡。
            f"{layout_ask}"
        )},
    ]


def generate_style_brief(
    spec: Dict[str, Any],
    *,
    llm_json_fn: Optional[Any] = None,
    device: str = "desktop",
    product_archetype: str = "",
) -> Optional[Dict[str, Any]]:
    """一次调用出两层风格。**挂了返回 None**，由调用方回落到确定性那套。"""
    page_ids = [str(p.get("id")) for p in (spec.get("pages") or [])
                if isinstance(p, dict) and p.get("id")]
    if not page_ids:
        return None
    from .spec_llm_call import call_spec_json

    try:
        outcome = call_spec_json(
            build_style_brief_prompt(
                spec, device=device, product_archetype=product_archetype
            ),
            llm_json_fn,
            stage="specfirst.design",
        )
    except Exception as exc:  # noqa: BLE001 — 审美挂了不该打死整轮
        print(f"[design_language] 风格段生成抛错：{str(exc)[:200]}")
        return None
    if outcome.payload is None:
        print(f"[design_language] 风格段生成失败：{outcome.failure}")
        return None
    brief = normalize_style_brief(outcome.payload, page_ids)
    if not style_brief_ok(brief, page_ids):
        print("[design_language] 风格段内容不够用（缺应用级基调或全部逐页计划）")
        return None
    return brief
