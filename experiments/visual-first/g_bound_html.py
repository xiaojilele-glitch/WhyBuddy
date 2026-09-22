"""G 组：让 HTML 带上绑定标注，变回「模板」而不是「渲染产物」。

## 要回答的问题

用户的比喻：HTML 是木偶（台前），五系统模型是提线的手（幕后），
改 JSON 就能无限迭代。

落差在于：截图生成的 HTML **身上没有装线的环**——写死的 "客户A"、
v-for 展开后的 5 行、没有 handler 的按钮。它是渲染产物，不是模板。

G 组就补这个环，然后验两件事：

    ① 值/行数能不能由模型驱动     —— 木偶提得动吗
    ② **给数据模型加一个字段，UI 跟不跟** —— "改 JSON 就迭代"成不成立

②才是关键。组件路线上 DataTable 会自动多一列（结构是活的）；
静态 HTML 里没有那个 <td>（结构是死的）。带了 rows 绑定之后是哪一种，
这一跑就知道。

## 两种方言，同一个语义

    G-alpine   x-for / x-text / @click      → 用现成的 Alpine.js（15KB，无构建）
    G-data     data-rows / data-field       → 中性标注，跟自由树的
                                              rowsRef/fieldRef 同源，自己解释

分两路是因为选型该由数据定：现成生态省事，中性标注不绑第三方且能复用
运行时已有的解释器。
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time

_HERE = pathlib.Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_ROOT / "slide-rule-python"))
for line in (_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
os.environ["APP_STORE_HTTP_API_URL"] = ""
os.environ["APP_STORE_HTTP_API_KEY"] = ""

MATERIALS = _HERE / "materials"
OUT = _HERE / "runs" / "g-bound"

_COMMON = """你要把一张**静态**的客户列表页改造成**模板**。

现在这张 HTML 是渲染产物：文字写死（"客户A（示意）"）、行是展开好的、
按钮没有行为。请在**不改变视觉**的前提下，把它变成能被数据驱动的模板：

- 写死的业务文字 → 换成字段绑定
- 重复的行 → 收成一个循环（**只保留一行当模板**，不要留 5 行）
- 按钮 → 标上它要触发什么动作

字段 id 必须来自下面给的数据模型，**不要自己发明字段**。
纯装饰性文字（表头、按钮文案、标题）保持原样，不要绑定。

只输出 HTML，不要解释，不要 markdown 围栏。"""

_ALPINE = _COMMON + """

用 **Alpine.js** 语法（页面里已经会注入 Alpine，你只写属性，不要写 <script>）：

    <tbody x-for 用法：<template x-for="row in customer"><tr>...</tr></template>
    <td x-text="row.customer_name"></td>
    <button @click="edit(row)">编辑</button>

可用的顶层数据是各实体的行数组，变量名就是实体 id（如 `customer`）。
可用的动作函数：`create()`、`edit(row)`、`remove(row)`。"""

_DATA = _COMMON + """

用**中性的 data-* 属性**（不依赖任何框架）：

    <tbody data-rows="customer">          ← 这个容器按 customer 的行数重复它的第一个子元素
      <tr>
        <td data-field="customer_name"></td>     ← 取当前行的这个字段
        <button data-action="edit">编辑</button>  ← 动作：create / edit / delete
      </tr>
    </tbody>

单值（不在行循环里的）用 data-value="<实体id>.<字段id>"。"""


def strip_fences(t: str) -> str:
    t = re.sub(r"^```(?:html)?\s*", "", t.strip())
    t = re.sub(r"\s*```$", "", t)
    i = t.lower().find("<!doctype")
    if i < 0:
        i = t.lower().find("<html")
    return t[i:] if i > 0 else t


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--page", default="screen_n3")
    args = ap.parse_args()

    from sliderule_llm.client import call_llm
    from sliderule_llm.config import get_llm_config

    html = (MATERIALS / "html" / f"{args.page}.html").read_text(encoding="utf-8")
    dm = json.loads(
        sorted((_HERE / "runs").glob("*/model_D1.json"))[-1].read_text(encoding="utf-8")
    )["datamodel"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "datamodel.json").write_text(json.dumps(dm, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"模型 {get_llm_config().model} | 输入 {args.page}.html {len(html)} 字符", flush=True)
    for tag, sys_extra in (("alpine", _ALPINE), ("data", _DATA)):
        for i in range(args.n):
            t0 = time.time()
            try:
                r = call_llm(
                    [
                        {"role": "system", "content": "你是前端工程师。只输出 HTML 文件内容。"},
                        {
                            "role": "user",
                            "content": sys_extra
                            + "\n\n=== 当前页面 HTML ===\n"
                            + html
                            + "\n\n=== 数据模型 ===\n"
                            + json.dumps(dm, ensure_ascii=False, indent=1),
                        },
                    ],
                    temperature=0.2,
                )
                out = strip_fences(r.content or "")
            except Exception as exc:  # noqa: BLE001
                print(f"[G-{tag}{i+1}] 抛异常 {str(exc)[:150]}", flush=True)
                continue
            p = OUT / f"G_{tag}{i+1}.html"
            p.write_text(out, encoding="utf-8")
            # 绑定标注数量：这是"模型到底有没有照做"的第一眼判据
            counts = {
                "x-for": out.count("x-for"), "x-text": out.count("x-text"),
                "@click": out.count("@click"),
                "data-rows": out.count("data-rows"), "data-field": out.count("data-field"),
                "data-action": out.count("data-action"),
            }
            live = {k: v for k, v in counts.items() if v}
            print(f"[G-{tag}{i+1}] {time.time()-t0:5.0f}s  {len(out):6d} 字符  绑定 {live}", flush=True)
    print(f"\n产物在 {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
