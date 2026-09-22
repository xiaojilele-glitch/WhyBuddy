"""⚠⚠ 本轮**作废**，结论已撤回。重测在 img_hop2.py，定案见 V6.0 架构图 ⚑3。⚠⚠

留着这个文件不是留结论，是留**犯错的形状**——它比结论有用。别再跑它，
也别引用它的数去支持任何主张。

## 这一轮错在哪（两条独立硬伤，都不是数错了，是设计错了）

① **V 路没在它最好的状态下被测。** 判据是这个实验自己写的纪律
   （runner.py:220）：「用成熟工具跑，否则测出来的差可能只是我 prompt 没调好」。
       T 路 —— 逐字抄 screenshot-to-code 的 create/text.py       ✅ 守了
       V 路 —— 下面 image_prompt_from_text 先让一个 LLM 把页面说明
               改写成 400~800 字提示词，再去生图                    ❌ 没守
   那个改写跳正是本仓记录过会掉东西的地方（V5.7 ✧4 预言过，✪ 段记了它确实
   复发——灰条）。**一条臂守纪律、另一条不守，量出来的差归不了因。**
   下面那句「HTML 少 41%」尤其要当心：改写跳在图画出来之前就已经丢了细节，
   那个数是我自己造成的，不是图造成的。

② **判据量不到关键维度。** 字段/实体/页面/区块数的是「反推出来的数据模型有
   多厚」；图该负责的是**版面结构有多丰富**（筛选栏分组、状态徽标、冲突标签、
   右侧详情栏、底部列表）。那四个数一个都碰不到。

## 原始数据留档（观测是真的，从它们推出的结论不是）

            字段 T/V     实体 T/V     页面 T/V     区块 T/V       墙钟 T/V
    r1      60/71       6/7        5/4       16/13      165s/239s
    r2      54/64       6/7        4/8       16/21      175s/253s
    r3      66/59       7/6        6/4       19/11      160s/249s

四项组间差都小于组内极差的一半。当时据此说「判据分不开两条路」——这句话本身
成立，但它成立的原因是**判据选错了**（硬伤②），不是「图没用」。

## 最终结论是怎么得出来的（不是靠这组数）

img_hop2.py 那轮：V 路换确定性模板零改写、2560x1440、图转 HTML 抄
screenshot-to-code 原版 + detail:high、渲染器修好（render_pages.cjs）。
判据换成**渲染出来用眼睛看**。用户看完 12 张 1920 宽截图裁决：
「很明显，是无图的生成的效果好」。**V 路那次是在它最好的状态下被测的**，
结论才立得住。

── 以下为作废时的原始头注，逐字保留 ──────────────────────────────

那张图到底有没有用？—— 决定第 3、4 步存不存在。

## 为什么要跑这一组

八步方案里第 3 步（按页写出图提示词）+ 第 4 步（并发生图）是插在
「spec → HTML」中间的一跳，代价是每页 60~85 秒外加 N 倍的钱。

而查开源的结论跟它冲突：**成熟项目没有一个走「文字 → 图 → HTML」**。
screenshot-to-code 的文字入口 `build_text_prompt_messages` 是
`Generate UI for {text_prompt}` + 技术栈 + 设计系统块 **直接出 HTML**；
OpenUI 也是描述直接出 HTML。mockup 那一类（quickmock / mydraft / MockupUI）
是人手画线框的编辑器，不相干。

之前那轮实验（A vs D，字段 25→37）证的是「**HTML 当输入**比纯意图强」。
D 组的 HTML 恰好是从图转的，但**没有对照组是直接从文字写的 HTML**——
也就是说那 12 个字段的功劳，到底归「有 HTML」还是归「HTML 是从图来的」，
从来没分开量过。

## 判据

同一份 spec（第 2 步真实产出的报修那份），两条路各出一套 HTML，
再各自推一份五系统模型，比字段数 / 实体数 / 页面数 / 臆造。

    T 路（无图）：spec 的一页 ──────────────→ HTML
    V 路（有图）：spec 的一页 → 出图提示词 → 图 → HTML

⚠ 唯一差别必须是那张图：两条路用**同一份 spec、同一页、同一个模型、
同一段技术栈约束**。T 路的提示词照抄 screenshot-to-code 的 create/text.py
口径（Generate UI for … + 栈 + 设计系统块），不自己另发明一套——
不然量到的是我写提示词的手艺，不是那张图的价值。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

_HERE = pathlib.Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_ROOT / "slide-rule-python"))
for _line in (_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    _line = _line.strip()
    if _line and not _line.startswith("#") and "=" in _line:
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
os.environ["SLIDERULE_SESSION_LOCAL_IMPORT"] = "0"

OUT = _HERE / "runs" / "img-hop"

# screenshot-to-code 的技术栈约束原文（backend/prompts/system_prompt.py 的
# Tailwind 段）。抄它而不是自己写，是为了让两条路的 HTML 风格可比。
_STACK = (
    "Use this script to include Tailwind: "
    '<script src="https://cdn.tailwindcss.com"></script>\n'
    "Return ONLY the full HTML file content. No explanation, no markdown fences."
)
# 同样抄自 screenshot-to-code：design_system 块 + 冲突时的优先级声明。
_DESIGN_SYSTEM = """## Design system

If the design system conflicts with other instructions, prioritize the design system.

<design_system>
企业后台风格，浅色底，左侧固定菜单 + 顶部面包屑。占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，
计数写 ×,×××，人名写「张师傅」这类。表格要有真实的中文列名。
</design_system>"""


def strip_fences(t: str) -> str:
    t = re.sub(r"^```(?:html)?\s*", "", (t or "").strip())
    t = re.sub(r"\s*```$", "", t)
    i = t.lower().find("<!doctype")
    if i < 0:
        i = t.lower().find("<html")
    return t[i:] if i > 0 else t


def page_brief(page: dict, spec: dict) -> str:
    """把 spec 的一页摊成自然语言。两条路共用，保证输入信息量相同。"""
    by_id = {n["id"]: n for n in spec["nodes"]}
    lines = [f"页面：{page['name']}", f"使用者：{page['audience']}", f"用途：{page['purpose']}"]
    lines.append("这一页要承载的需求：")
    for ref in page["coversNodes"]:
        n = by_id.get(ref)
        if not n:
            continue
        detail = n.get("acceptance") or n.get("notes") or ""
        lines.append(f"- {n['title']}：{detail}")
    return "\n".join(lines)


def html_from_text(brief: str) -> str:
    """T 路：文字直出 HTML。口径照抄 screenshot-to-code 的 create/text.py。"""
    from sliderule_llm.client import call_llm

    user = f"""Generate UI for:

{brief}

{_STACK}

{_DESIGN_SYSTEM}

# Instructions

- Make sure to make it look modern and sleek.
- Use modern, professional fonts and colors.
- Follow UX best practices."""
    r = call_llm(
        [
            {"role": "system", "content": "You are an expert at building front-ends."},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    return strip_fences(r.content or "")


def image_prompt_from_text(brief: str) -> str:
    """V 路第 1 跳：把一页的说明改写成文生图提示词。

    两段式照搬仓里 `_SHEET_PROMPT_REFINE_SYSTEM` 的口径（只给事实、让 LLM
    现写提示词），但输入换成 spec 的一页——那正是第 3 步要做的事。
    """
    from sliderule_llm.client import call_llm

    system = (
        "你是给文生图模型写提示词的人。下面给你一个企业应用某一页的说明。"
        "请写出一段中文文生图提示词，用来生成这一页的 UI 版式参照图。"
        "只输出提示词正文，不要解释。版式由你按这一页的业务性质决定，"
        "不要套「顶部一排指标卡 + 下面两张图 + 底部一张表」那种通用后台网格。"
        "画面里不许出现真实数据，占位必须写成**看得见的可读文字**"
        "（日期 20XX-XX-XX、金额 ¥ ××,×××、计数 ×,×××、人名「张师傅」），"
        "不许用灰色横条或色块代替。长度 400~800 字，写成一段连贯中文。"
    )
    r = call_llm(
        [{"role": "system", "content": system}, {"role": "user", "content": brief}],
        temperature=0.3,
    )
    return (r.content or "").strip()


def html_from_image(png: bytes, brief: str) -> str:
    """V 路第 3 跳：图 → HTML。走 screenshot-to-code 的口径（图 + 同一段栈约束）。"""
    from sliderule_llm.client import call_llm

    b64 = base64.b64encode(png).decode()
    user = [
        {"type": "text", "text": (
            f"Generate the HTML for this UI screenshot.\n\n"
            f"业务背景（仅用于给元素取中文名，版式一律以图为准）：\n{brief}\n\n"
            f"{_STACK}\n\n{_DESIGN_SYSTEM}"
        )},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]
    r = call_llm(
        [
            {"role": "system", "content": "You are an expert at building front-ends."},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    return strip_fences(r.content or "")


def derive_model(goal: str, html: list[tuple[str, str]]) -> dict | None:
    """两条路共用同一个推导器：runner.py 的 D 组，一个字都不改。"""
    from runner import run_d  # noqa: PLC0415 — 同目录脚本，延后导入避开 env 装配顺序

    return run_d(goal, html)


def measure(model: dict | None) -> dict:
    if not model:
        return {"字段": 0, "实体": 0, "页面": 0, "区块": 0}
    dm = model.get("datamodel") or {}
    ents = dm.get("entities") or []
    pages = (model.get("page") or {}).get("pages") or []
    blocks = sum(len(p.get("blocks") or []) for p in pages)
    return {
        "字段": sum(len(e.get("fields") or []) for e in ents),
        "实体": len(ents),
        "页面": len(pages),
        "区块": blocks,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=str(
        pathlib.Path("/tmp/claude-0/-home-user-WhyBuddy/"
                     "8eb18365-d2f0-5192-aab8-d1abdb0dfb09/scratchpad/spec_out/报修.json")))
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--tag", default="", help="产物子目录，跑多轮时区分")
    args = ap.parse_args()

    from sliderule_llm.image_client import generate_image_png, get_image_gen_config

    spec = json.loads(pathlib.Path(args.spec).read_text(encoding="utf-8"))
    pages = spec["pages"][: args.pages]
    goal = "设备报修工单系统"
    out = OUT / args.tag if args.tag else OUT
    globals()["OUT"] = out
    out.mkdir(parents=True, exist_ok=True)
    briefs = [(p["id"], page_brief(p, spec)) for p in pages]
    print(f"spec：{len(spec['pages'])} 页，取前 {len(briefs)} 页\n", flush=True)

    # ── T 路：文字直出 HTML（并发）────────────────────────────────
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        t_html = list(pool.map(lambda b: html_from_text(b[1]), briefs))
    t_cost = time.time() - t0
    for (pid, _), src in zip(briefs, t_html):
        (OUT / f"T_{pid}.html").write_text(src, encoding="utf-8")
    print(f"[T 无图] {t_cost:5.0f}s  HTML {[len(h) for h in t_html]} 字符", flush=True)

    # ── V 路：提示词 → 图 → HTML（每跳并发）──────────────────────
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        prompts = list(pool.map(lambda b: image_prompt_from_text(b[1]), briefs))
    p_cost = time.time() - t0
    cfg = get_image_gen_config("SHEET_") or get_image_gen_config()

    def _gen(pr: str) -> bytes | None:
        try:
            return generate_image_png(pr, cfg=cfg, size="1536x1024")
        except Exception as exc:  # noqa: BLE001
            print(f"    出图失败：{str(exc)[:120]}", flush=True)
            return None

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        pngs = list(pool.map(_gen, prompts))
    i_cost = time.time() - t0
    for (pid, _), png, pr in zip(briefs, pngs, prompts):
        (OUT / f"V_{pid}.prompt.txt").write_text(pr, encoding="utf-8")
        if png:
            (OUT / f"V_{pid}.png").write_bytes(png)
    print(f"[V 有图] 提示词 {p_cost:4.0f}s · 出图 {i_cost:4.0f}s "
          f"（{sum(1 for p in pngs if p)}/{len(pngs)} 张成功）", flush=True)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        v_html = list(pool.map(
            lambda x: html_from_image(x[0], x[1][1]) if x[0] else "",
            list(zip(pngs, briefs))))
    v_cost = time.time() - t0
    for (pid, _), src in zip(briefs, v_html):
        if src:
            (OUT / f"V_{pid}.html").write_text(src, encoding="utf-8")
    print(f"[V 有图] 图转 HTML {v_cost:4.0f}s  HTML {[len(h) for h in v_html]} 字符", flush=True)

    # ── 各推一份五系统模型，同一个推导器 ─────────────────────────
    print("\n推导五系统模型（两条路共用 runner.run_d）……", flush=True)
    t_model = derive_model(goal, [(f"{pid}.html", h) for (pid, _), h in zip(briefs, t_html) if h])
    v_model = derive_model(goal, [(f"{pid}.html", h) for (pid, _), h in zip(briefs, v_html) if h])
    for tag, m in (("T", t_model), ("V", v_model)):
        if m:
            (OUT / f"model_{tag}.json").write_text(
                json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")

    tm, vm = measure(t_model), measure(v_model)
    print("\n" + "=" * 58)
    print(f"{'':10}{'字段':>6}{'实体':>6}{'页面':>6}{'区块':>6}   墙钟")
    print(f"{'T 无图':10}{tm['字段']:>6}{tm['实体']:>6}{tm['页面']:>6}{tm['区块']:>6}   {t_cost:.0f}s")
    print(f"{'V 有图':10}{vm['字段']:>6}{vm['实体']:>6}{vm['页面']:>6}{vm['区块']:>6}   "
          f"{p_cost + i_cost + v_cost:.0f}s")
    print("=" * 58)
    print(f"产物在 {OUT}")
    (OUT / "result.json").write_text(json.dumps({"T": tm, "V": vm,
        "墙钟": {"T": round(t_cost), "V": round(p_cost + i_cost + v_cost)}},
        ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
