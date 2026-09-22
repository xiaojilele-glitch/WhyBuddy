"""那张图到底有没有用 —— **重测**（img_hop.py 那轮作废，见下）。

## 为什么要重跑

img_hop.py 那轮（n=3）得出「第 3、4 步该删」，并据此把八步改成六步。
**结论撤回了**，两条独立的硬伤：

① **V 路没有在它最好的状态下被测。** 判据是这个实验自己写的纪律
   （runner.py:220）：「用成熟工具跑，C 组才是在它的最好状态下被测——否则
   测出来的差可能只是我 prompt 没调好」。当时：

       T 路 —— 逐字抄 screenshot-to-code 的 create/text.py        ✅ 成熟状态
       V 路 —— img_hop.py:126 先让一个 LLM 把页面说明改写成
               400~800 字提示词，**再**去生图                      ❌

   那个改写跳正是本仓记录过会掉东西的地方（V5.7 ✧4 预言、✪ 段记了它确实
   复发，灰条）。对一路守纪律、对另一路不守，测出来的差归不了因。

② **判据量不到关键维度。** 字段/实体/页面/区块数量的是「反推出来的数据模型
   有多厚」；而图该负责的是**版面结构有多丰富**——筛选栏分组、状态徽标、
   冲突标签、右侧详情栏、底部列表。那四个数一个都碰不到。

## 这一轮改了什么

    出图提示词    LLM 改写 400~800 字  →  **确定性模板**，spec 直接填，零改写
    分辨率        1536x1024            →  **2560x1440**
    判据          只数模型字段          →  **版面 12 项** + 模型 4 项（后者留作续测）
    出图真伪      没查                 →  抄 skills/sliderule 的 check_previews_real
                                          口径：假成功 / 内容重复 当场判违规

⚠ 模板照的是真出过好效果的那份（materials/previews/provenance-crm-4pages.json）。
它跟旧那份的差别不是「更长」，是**确定性 vs 改写**，以及末尾那句
「每个页面布局要各不相同」——它给的是**分化要求不是禁令**，比任何
「不许套通用后台网格」都管用（同一条经验见 GEN5 节点：不给出路的禁令会被绕过）。

## 唯一变量仍然是那张图

两条路共用：同一份 spec、同一页、同一个模型、同一段技术栈约束与设计系统块。
T 路的提示词一个字不动——它上一轮就在成熟状态，改它反而会引入新的混杂。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
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

from img_hop import (  # noqa: E402 — 复用上一轮，两轮才可比
    _DESIGN_SYSTEM,
    _STACK,
    html_from_text,
    page_brief,
    strip_fences,  # noqa: F401 — 供交互式调试
)

OUT = _HERE / "runs" / "img-hop2"

#: 出图分辨率。上一轮 1536x1024 实收 1248x832（这家自己贴合宽高比），
#: 版面被压得画不下多少东西。2560x1440 是 16:9，给密度留出空间。
#: ⚠ 认不认 size 是**端点相关行为**，跑之前先看 provenance 里的实收尺寸，
#:   别拿这里写的数当成实际拿到的（本仓这条规矩已经救过三次场）。
IMAGE_SIZE = "2560x1440"


# ── 出图提示词：确定性模板，spec 直接填 ──────────────────────────────
#
# 逐字段对着 provenance-crm-4pages.json 那份的形状：
#   ① 产品一句话（旧那份的 page_brief 没有——模型不知道这是个什么产品）
#   ② 页面名
#   ③ acceptance **原文**，不经改写
#   ④ design notes
#   ⑤ 固定的版式要求句 + PREVIEW 标记
#   ⑥ 「每个页面布局要各不相同」
def image_prompt_from_spec(product: str, page: dict, spec: dict) -> str:
    """V 路第 1 跳。**没有 LLM**——这是模板填空，不是生成。

    这正是上一轮的病灶所在：那里插了一个 LLM 把说明重写成提示词，
    而重写会掉东西。模板填空掉不了，因为它根本没有「理解再复述」这一步。
    """
    by_id = {n["id"]: n for n in spec["nodes"]}
    acceptance, notes = [], []
    for ref in page.get("coversNodes") or []:
        n = by_id.get(ref)
        if not n:
            continue
        if n.get("acceptance"):
            acceptance.append(n["acceptance"].strip())
        if n.get("notes"):
            notes.append(n["notes"].strip())
    parts = [
        f"为产品「{product}」的「{page['name']}」这个页面，生成一张 Web 界面草样(UI mockup)。"
    ]
    if acceptance:
        parts.append("该页面要能体现：" + "".join(acceptance) + "。")
    if notes:
        parts.append("设计要点：" + "".join(notes) + "。")
    parts.append(
        "要求：画出真实的页面布局（顶部导航 + 主操作区 + 列表/卡片/侧栏等），"
        "中文占位文案、只示意不写真实数据。"
    )
    # ⚠ 2026-08-13 用户裁决：去掉参照模板末尾那两句——
    #     「右上角明显标注 PREVIEW。」「每个页面布局要各不相同。」
    #   这是**对参照模板的一处有意偏离**，记下来免得下次当成抄漏：
    #   · PREVIEW 那句会在图上画一条角标丝带，图转 HTML 时会被原样复刻进产物，
    #     等于给每一页都留一块跟业务无关的装饰。
    #   · 「各不相同」那句我原本判断是按住通用后台网格的关键（给分化要求而不是
    #     禁令）。**那只是判断，没测过。** 去掉它正好把这个判断也一起验了——
    #     如果页面从此长得千篇一律，说明我那条判断是对的；如果没有，说明我
    #     又把一个没验过的想法当成了结论。
    # ⚠ acceptance 自己带句号，这里再补一个「。」会拼出「……入口。。要求：」。
    #   **故意不修**：参照那份（provenance-crm-4pages.json）逐字就是这样，而它是
    #   唯一真出过好效果的样本。这一轮要测的是那份模板，不是我改进过的版本——
    #   顺手"优化"一处就不知道测的还是不是它了。等这轮有了基线再谈清理。
    return "".join(parts)


# ── 版面丰富度判据 ──────────────────────────────────────────────────
#
# 上一轮量的是「反推出来的模型有多厚」，量不到图该负责的东西。这一组直接量
# **HTML 本身**：一张图值不值，看它换来的版面有没有更多结构与可操作性。
#
# ⚠ 每一项都得能机械数出来，不许有「看着更丰富」这种判断。
# ⚠ 不数字符数：上一轮吃过亏——T 路 HTML 一致更大，但大不等于结构多，
#   Tailwind 的长 class 串能把任何东西撑大。
_CONTROLS = {
    "输入框": r"<input\b",
    "下拉": r"<select\b|role=[\"']combobox",
    "多选框": r"type=[\"']checkbox",
    "单选": r"type=[\"']radio",
    "按钮": r"<button\b",
    "表格": r"<table\b",
    "列表": r"<ul\b|<ol\b",
    "标签页": r"role=[\"']tab|tab-|Tab\b",
    "徽标": r"badge|tag-|rounded-full",
    "日历格": r"grid-cols-7|日|周一",
    "侧栏": r"<aside\b|sidebar|w-6[0-9]|w-7[0-9]",
    "分页": r"pagination|分页|上一页|下一页",
}


def layout_metrics(html: str) -> dict:
    """版面结构判据。数的是**种类**不是次数——一页里 30 个 input 不比 3 个丰富。"""
    if not html:
        return {"区域数": 0, "控件种类": 0, "有列表区": 0, "标题层级": 0, "字符": 0}
    low = html.lower()
    kinds = sum(1 for pat in _CONTROLS.values() if re.search(pat, html, re.I))
    return {
        # 区域 = 语义分区数。用 section/aside/header/nav/main 这些语义标签数，
        # 不数 <div>——div 数量跟版式复杂度关系太弱（Tailwind 每层都套 div）。
        "区域数": len(re.findall(r"<(section|aside|header|nav|main|footer)\b", low)),
        "控件种类": kinds,
        # 「有没有列表区」单独拎出来：⛔4 记着参照图**从来不被允许画列表**，
        # 而 rowsRef / actionRef 的实测坏点全在列表区。这一项是那条的对照。
        "有列表区": 1 if re.search(r"<table\b|<ul\b|<ol\b", low) else 0,
        "标题层级": len({m for m in re.findall(r"<h([1-6])\b", low)}),
        "字符": len(html),
    }


# ── V 路第 3 跳：图 → HTML，换成 screenshot-to-code 的原版口径 ──────────
#
# 上一版（img_hop.html_from_image）是我自己随手写的一句「Generate the HTML for
# this UI screenshot」。修完第 1 跳之后它就成了这条路上最后一处**不对称**：
# T 路逐字抄了 create/text.py，V 路的图转 HTML 却没抄 create/image.py。
#
# 拉下来逐字对，差四处，最后一处是硬伤：
#   ① 它说 "looks **exactly** like the provided screenshot(s)"，我只说 "generate the HTML"
#   ② 它有一整段 Replication instructions（照抄原文里不依赖工具的那两条）
#   ③ 它把**图放在文字前面**，我放在后面
#   ④ **`detail: "high"`** —— 我压根没传。不传就是 auto，2560x1440 这种密集
#      界面会被降采样，模型看到的根本不是那张图。这一条足以单独解释
#      「图很漂亮但 HTML 很薄」（r1 实测丢了分页）。
#
# ⚠ 三条 asset 工具指令（extract_assets / edit_images / generate_images）**故意不抄**：
#   我们这个 harness 没有这些工具，抄进来等于让模型去调不存在的东西。
#   对应地，image policy 取它 `build_user_image_policy(False)` 那一支的原文。
# ⚠ system 消息保持 "You are an expert at building front-ends."：上游 main 已经
#   改成带工具的 agent 架构（create_file / screenshot_preview…），跟这个单发
#   harness 不是一回事。**这是一处明写的偏离，不是抄漏了。**
_S2C_STACK_POLICY = "Selected stack: html_tailwind."
_S2C_IMAGE_POLICY = (
    "Image generation is disabled for this request. Do not call generate_images. "
    "Use provided media, CSS effects, or placeholder URLs (https://placehold.co)."
)


def html_from_image_s2c(png: bytes, brief: str) -> str:
    from sliderule_llm.client import call_llm

    b64 = base64.b64encode(png).decode()
    user_text = f"""
Generate code for a web page that looks exactly like the provided screenshot(s).

{_S2C_STACK_POLICY}
{_STACK}
{_DESIGN_SYSTEM}

## Replication instructions

- Make sure the web page looks exactly like the screenshot.
- Use the exact text from the screenshot.
- {_S2C_IMAGE_POLICY}

Additional instructions: 业务背景（仅用于给元素取中文名，版式一律以图为准）：
{brief}
""".strip()
    return strip_fences((call_llm(
        [
            {"role": "system", "content": "You are an expert at building front-ends."},
            {"role": "user", "content": [
                # 图在前、文字在后——跟 create/image.py 的 user_content 装配顺序一致
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}},
                {"type": "text", "text": user_text},
            ]},
        ],
        temperature=0.2,
    ).content or ""))


def measure_model(model: dict | None) -> dict:
    """上一轮那四项原样保留——不是因为它们判得了这件事，是为了**两轮可比**。"""
    if not model:
        return {"字段": 0, "实体": 0, "页面": 0, "区块": 0}
    ents = (model.get("datamodel") or {}).get("entities") or []
    pages = (model.get("page") or {}).get("pages") or []
    return {
        "字段": sum(len(e.get("fields") or []) for e in ents),
        "实体": len(ents),
        "页面": len(pages),
        "区块": sum(len(p.get("blocks") or []) for p in pages),
    }


# ── 出图真伪审计：抄 skills/sliderule/scripts/check_previews_real.py 的口径 ──
#
# 为什么必须查：上一轮**默认「出了图就是出了图」**。但生图这条链是 fail-open 的，
# 而且这家端点实测会随机换响应形态。真正会毁掉一轮对照的是两种静默情况：
#   · 四页拿到的是**同一张图**（contentHash 相同）→ 组间差全归噪声
#   · 「成功」但文件只有几百字节 → 后面那跳看的是一张空图
# 这两种都不会报错，只会让数字变得没意义——正是这轮要防的那类假绿。
def audit_previews(metas: list[dict]) -> list[tuple[str, str]]:
    seen: dict[str, str] = {}
    bad: list[tuple[str, str]] = []
    for m in metas:
        pid = str(m.get("imageId") or "")
        if not m.get("ok"):
            continue
        if int(m.get("fileSizeBytes") or 0) < 1024:
            bad.append((pid, "fake_success"))
            continue
        h = str(m.get("contentHash") or "")
        if h:
            prev = seen.get(h)
            if prev and prev != pid:
                bad.append((pid, f"duplicate_content（与 {prev} 同图）"))
            seen[h] = pid
    return bad


def load_or_make_spec(path: pathlib.Path, goal: str) -> dict:
    """spec 优先读缓存，没有就**用真正的第 2 步现生成一份**。

    ⚠ 刻意不用 materials/spec_tree.json（那是手工的）：用户要的是
    「**spec 推演出来的**」，那就得走 services.spec_tree.generate_spec_tree——
    也就是 08-13 刚落地的那一步。拿手工件跑，测的还是手工件。
    """
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    from services.spec_tree import generate_spec_tree

    spec = generate_spec_tree(goal)
    data = spec.model_dump(mode="json") if hasattr(spec, "model_dump") else spec
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--goal", default="设备报修工单系统：报修登记、派工、维修跟踪与验收闭环")
    ap.add_argument("--spec", default=str(_HERE / "runs" / "spec-cache" / "报修.json"))
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--tag", default="")
    ap.add_argument("--reuse-images", default="",
                    help="复用某轮产物目录里的 V_*.png，不重新出图——把变量锁在图转HTML那一跳")
    ap.add_argument("--skip-model", action="store_true",
                    help="只跑到 HTML + 版面判据，不推五系统模型（省一半时间）")
    args = ap.parse_args()

    from sliderule_llm.image_client import generate_image_png, get_image_gen_config

    spec = load_or_make_spec(pathlib.Path(args.spec), args.goal)
    product = args.goal.strip()
    pages = spec["pages"][: args.pages]
    out = OUT / args.tag if args.tag else OUT
    out.mkdir(parents=True, exist_ok=True)
    briefs = [(p["id"], page_brief(p, spec)) for p in pages]
    print(f"spec：{len(spec['pages'])} 页 / {len(spec['nodes'])} 节点 / "
          f"{len(spec['successCriteria'])} 判据，取前 {len(briefs)} 页\n", flush=True)

    # ── T 路（一个字没改，保证与上一轮可比）───────────────────────
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        t_html = list(pool.map(lambda b: html_from_text(b[1]), briefs))
    t_cost = time.time() - t0
    for (pid, _), src in zip(briefs, t_html):
        (out / f"T_{pid}.html").write_text(src, encoding="utf-8")
    print(f"[T 无图] {t_cost:5.0f}s", flush=True)

    # ── V 路第 1 跳：模板填空，**零 LLM、零耗时** ─────────────────
    prompts = [image_prompt_from_spec(product, p, spec) for p in pages]
    for (pid, _), pr in zip(briefs, prompts):
        (out / f"V_{pid}.prompt.txt").write_text(pr, encoding="utf-8")
    print(f"[V 有图] 提示词 0s（模板填空·不发 LLM）"
          f" 长度 {[len(p) for p in prompts]}", flush=True)

    # ── V 路第 2 跳：出图 ─────────────────────────────────────────
    cfg = get_image_gen_config("SHEET_") or get_image_gen_config()
    if cfg is None:
        print("！生图三项没配齐，这一轮跑不了（fail-closed）", flush=True)
        return 2

    def _gen(pr: str) -> tuple[bytes | None, str | None]:
        try:
            return generate_image_png(pr, cfg=cfg, size=IMAGE_SIZE), None
        except Exception as exc:  # noqa: BLE001
            return None, str(exc)[:300]

    if args.reuse_images:
        # 复用上一轮的图，把变量锁死在「图转 HTML 的提示词」这一处。
        # ⚠ 这是这一轮唯一能干净归因的做法：重新出图会同时改变图本身，
        #   那样又变成两个变量一起动——正是前几轮栽过的形状。
        src = pathlib.Path(args.reuse_images)
        gen = [((src / f"V_{pid}.png").read_bytes()
                if (src / f"V_{pid}.png").exists() else None, None) for pid, _ in briefs]
        i_cost = 0.0
        print(f"[V 有图] 复用 {args.reuse_images} 的图"
              f"（{sum(1 for g, _ in gen if g)}/{len(gen)} 张）——变量只剩图转HTML的提示词", flush=True)
    else:
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
            gen = list(pool.map(_gen, prompts))
        i_cost = time.time() - t0

    metas = []
    for (pid, _), (png, err), pr in zip(briefs, gen, prompts):
        if png:
            (out / f"V_{pid}.png").write_bytes(png)
        metas.append({
            "imageId": pid, "prompt": pr, "model": cfg.model, "size": IMAGE_SIZE,
            "ok": png is not None, "error": err,
            "fileSizeBytes": len(png) if png else 0,
            "contentHash": hashlib.sha256(png).hexdigest() if png else "",
            "output": f"V_{pid}.png" if png else None,
            "label": "预览·未验证 / preview-unverified",
        })
    (out / "provenance.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_n = sum(1 for m in metas if m["ok"])
    print(f"[V 有图] 出图 {i_cost:4.0f}s（{ok_n}/{len(metas)} 张）"
          f" 字节 {[m['fileSizeBytes'] for m in metas]}", flush=True)

    # ⚠ 审计放在推导之前：一轮跑坏了要当场知道，不要等数出来再回头怀疑
    bad = audit_previews(metas)
    if bad:
        print("！出图审计不通过（抄 skills/sliderule 的口径）：", flush=True)
        for pid, why in bad:
            print(f"    {pid}：{why}", flush=True)
        print("  这一轮的 V 路数据**不可用**——四张图若是同一张，组间差全是噪声。", flush=True)
    else:
        print(f"  出图审计通过：{ok_n} 张各不相同、均非空", flush=True)

    # ── V 路第 3 跳：图 → HTML ────────────────────────────────────
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=len(briefs)) as pool:
        v_html = list(pool.map(
            lambda x: html_from_image_s2c(x[0][0], x[1][1]) if x[0][0] else "",
            list(zip(gen, briefs))))
    v_cost = time.time() - t0
    for (pid, _), src in zip(briefs, v_html):
        if src:
            (out / f"V_{pid}.html").write_text(src, encoding="utf-8")
    print(f"[V 有图] 图转 HTML {v_cost:4.0f}s\n", flush=True)

    # ── 版面判据：这一轮的主判据 ──────────────────────────────────
    def agg(htmls: list[str]) -> dict:
        ms = [layout_metrics(h) for h in htmls if h]
        if not ms:
            return {}
        return {k: sum(m[k] for m in ms) / len(ms) for k in ms[0]}

    t_lay, v_lay = agg(t_html), agg(v_html)
    print("版面判据（每页均值 · 这一轮的主判据）")
    print(f"{'':10s}{'T 无图':>10s}{'V 有图':>10s}{'差':>10s}")
    for k in ("区域数", "控件种类", "有列表区", "标题层级", "字符"):
        tv, vv = t_lay.get(k, 0), v_lay.get(k, 0)
        print(f"{k:10s}{tv:10.1f}{vv:10.1f}{vv - tv:+10.1f}")

    summary = {
        "size": IMAGE_SIZE, "pages": len(briefs), "prompt": "deterministic-template",
        "cost": {"T": round(t_cost), "V_img": round(i_cost), "V_html": round(v_cost)},
        "layout": {"T": t_lay, "V": v_lay},
        "previewAudit": {"ok": not bad, "violations": bad},
    }

    # ── 模型判据：留作与上一轮可比，**不再是主判据** ───────────────
    if not args.skip_model:
        from img_hop import derive_model
        print("\n推导五系统模型（两条路共用 runner.run_d）……", flush=True)
        t_model = derive_model(args.goal, [(f"{p}.html", h) for (p, _), h in zip(briefs, t_html) if h])
        v_model = derive_model(args.goal, [(f"{p}.html", h) for (p, _), h in zip(briefs, v_html) if h])
        tm, vm = measure_model(t_model), measure_model(v_model)
        print(f"{'':10s}{'T 无图':>10s}{'V 有图':>10s}")
        for k in ("字段", "实体", "页面", "区块"):
            print(f"{k:10s}{tm[k]:10d}{vm[k]:10d}")
        summary["model"] = {"T": tm, "V": vm}

    (out / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n产物：{out}")
    # ⚠ 一轮不是结论：runner.py 的默认就是 --n 3，理由是方差极大。
    #   这个脚本一次只跑一轮，多轮请跑多次 --tag r1/r2/r3 再取中位数。
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
