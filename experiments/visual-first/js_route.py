"""F 组：让模型自己写 JS 实现增删改查，跟组件路线比。

## 为什么要单跑这一组

前面 A–E 比的是「用什么证据推五系统模型」，产出都是**模型**，行为由运行时保证。
这一组换了性质：**产出是代码**，行为由生成的 JS 自己保证。
「抛弃组件库、逻辑用 JavaScript 做」这个提案，成不成立就看这一组。

## 判据：真跑，不读代码

读代码判断"看起来能跑"没有意义——生成的 JS 有没有语法错、事件绑没绑上、
数据落没落住，只有在浏览器里点一遍才知道。所以六步全是 Playwright 真交互：

    ① 打开        无 console error，列表渲染出行
    ② 新建        填表 → 提交 → 列表里多一行
    ③ 刷新        重新加载 → 新建的那行还在（持久化）
    ④ 空表单      直接提交 → 被拦下（校验）
    ⑤ 编辑        改一条 → 值真的变了
    ⑥ 删除        删一条 → 行数减一

不给它指定用什么存（localStorage / IndexedDB 随它挑）——③ 只问"刷新后还在吗"，
怎么实现是它的自由。同理不指定校验怎么做，④ 只问"空表单拦不拦"。

## 输入

跟 D 组同一份材料：screen_n3（客户列表 + 筛选，CRUD 面最全）的 HTML，
加上 D 组反推出来的 datamodel。两条路线拿到的信息量对齐。
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
OUT = _HERE / "runs" / "js-route"

_INSTRUCTION = """你要把一张静态的客户列表页改造成**真的能用**的单页应用。

下面给你两样东西：
1. 这一页现在的 HTML（静态的，所有数据都是写死的占位）
2. 这个系统的数据模型（客户实体的真实字段定义）

请输出**一个完整的单文件 HTML**（含 <script>，原生 JavaScript，不要引入
构建工具或框架），在原页面视觉基本不变的前提下，实现客户数据的：

- **列表**：从存储读取并渲染，不再是写死的行
- **新建**：打开表单、填写、保存后列表立即出现新行
- **编辑**：选中一行改值，保存后列表里的值跟着变
- **删除**：删掉一行，列表少一行
- **校验**：不合法的输入要拦下并提示（字段类型见数据模型；enum 字段只能填
  options 里的值）
- **持久化**：刷新页面后数据还在

为了让自动化测试点得到，请给关键元素加上这些属性（**必须一字不差**）：

    data-testid="row"            每一行客户
    data-testid="btn-create"     打开新建表单的按钮
    data-testid="form"           新建/编辑表单容器
    data-testid="field-<字段id>" 表单里每个输入控件（字段 id 见数据模型）
    data-testid="btn-submit"     表单提交按钮
    data-testid="btn-edit"       每一行的编辑按钮
    data-testid="btn-delete"     每一行的删除按钮
    data-testid="error"          校验失败时出现的提示元素

只输出 HTML，不要任何解释文字，不要 markdown 围栏。"""


def build_messages(html: str, datamodel: dict) -> list[dict]:
    return [
        {
            "role": "system",
            "content": "你是前端工程师。只输出可直接保存运行的 HTML 文件内容。",
        },
        {
            "role": "user",
            "content": _INSTRUCTION
            + "\n\n=== 当前页面 HTML ===\n"
            + html
            + "\n\n=== 数据模型 ===\n"
            + json.dumps(datamodel, ensure_ascii=False, indent=1),
        },
    ]


def strip_fences(text: str) -> str:
    t = re.sub(r"^```(?:html)?\s*", "", text.strip())
    t = re.sub(r"\s*```$", "", t)
    i = t.lower().find("<!doctype")
    if i < 0:
        i = t.lower().find("<html")
    return t[i:] if i > 0 else t


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--page", default="screen_n3")
    args = ap.parse_args()

    from sliderule_llm.client import call_llm
    from sliderule_llm.config import get_llm_config

    html = (MATERIALS / "html" / f"{args.page}.html").read_text(encoding="utf-8")
    dm = json.loads(
        (sorted((_HERE / "runs").glob("*/model_D1.json"))[-1]).read_text(encoding="utf-8")
    )["datamodel"]

    cfg = get_llm_config()
    print(f"模型 {cfg.model} | effort={cfg.reasoning_effort}")
    print(f"输入：{args.page}.html {len(html)} 字符 + datamodel "
          f"{sum(len(e.get('fields') or []) for e in dm['entities'])} 字段", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "datamodel.json").write_text(json.dumps(dm, ensure_ascii=False, indent=1), encoding="utf-8")

    for i in range(args.n):
        t0 = time.time()
        try:
            r = call_llm(build_messages(html, dm), temperature=0.2)
            out = strip_fences(r.content or "")
        except Exception as exc:  # noqa: BLE001
            print(f"[F{i+1}] 生成抛异常 {str(exc)[:160]}", flush=True)
            continue
        el = time.time() - t0
        p = OUT / f"F{i+1}.html"
        p.write_text(out, encoding="utf-8")
        u = r.usage or {}
        print(f"[F{i+1}] {el:5.0f}s  {len(out):6d} 字符  "
              f"script {out.count('<script')} 段  completion={u.get('completion_tokens')}", flush=True)
    print(f"\n产物在 {OUT}，接下来跑 js_route_test.mjs 做真交互验证")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
