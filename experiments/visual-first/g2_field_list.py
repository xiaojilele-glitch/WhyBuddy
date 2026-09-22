"""G2：把「字段清单驱动结构」搬进 HTML 属性，验最后一格。

## 上一跑卡在哪

G 组四份全部做到了"值和行数被驱动"，但**加字段 UI 不跟**——因为模板里没有
那个 `<td>`。这不是实现问题，是模板这个形态本身：Vue 也一样。

而组件路线不同，因为 `DataTable` **不是模板**，是被字段清单驱动的通用渲染器：
`binding.fieldRefs` 多一项就多一列。

G2 就试把这个契约搬进 HTML：

    <thead data-head="customer"></thead>            表头由字段清单生成
    <tbody data-rows="customer" data-fields="*">    * = 该实体的全部字段
      <tr><td data-cell></td></tr>                  一个单元格模板，按字段数重复

如果成立，HTML 就同时拿到了「丰富度」（视觉线给的）和「结构活性」（字段清单
给的）——那是这条路线能不能替代组件的最后一格。

## 判据

跟 G 一样两项，但②换成真正的结构变化：**往 datamodel 里加一个字段**
（不只是往数据里加一列），看列会不会自己长出来。
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
OUT = _HERE / "runs" / "g2-fieldlist"

PROMPT = """你要把一张**静态**的客户列表页改造成**由数据模型驱动**的模板。

跟普通模板的关键区别：**列不是你画死的，是数据模型的字段清单决定的**。
所以表格那部分不要写固定的 `<th>` 和 `<td>`，改成声明"这里渲染这个实体的
字段清单"，让运行时按清单展开。

绑定词汇（**必须一字不差**）：

    <thead data-head="customer"><tr><th data-col></th></tr></thead>
        表头：data-head 指实体 id；里面留**一个** <th data-col> 当模板，
        运行时按字段清单重复它，填字段的显示名。

    <tbody data-rows="customer" data-fields="*"><tr><td data-cell></td></tr></tbody>
        数据行：data-rows 指实体 id；data-fields="*" 表示用该实体的全部字段
        （也可以写成逗号分隔的字段 id 白名单）。
        里面留**一个** <tr>，<tr> 里留**一个** <td data-cell> 当单元格模板。

    <button data-action="edit">编辑</button>     动作：create / edit / delete
    <span data-value="customer.total">           单值（不在行循环里的）

其余部分（顶部导航、筛选区、按钮、标题）**保持原样**，视觉不要变。
纯装饰性文字不要绑定。

只输出 HTML，不要解释，不要 markdown 围栏。"""


def strip_fences(t: str) -> str:
    t = re.sub(r"^```(?:html)?\s*", "", t.strip())
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
        sorted((_HERE / "runs").glob("*/model_D1.json"))[-1].read_text(encoding="utf-8")
    )["datamodel"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "datamodel.json").write_text(json.dumps(dm, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"模型 {get_llm_config().model} | 输入 {len(html)} 字符", flush=True)

    for i in range(args.n):
        t0 = time.time()
        try:
            r = call_llm(
                [
                    {"role": "system", "content": "你是前端工程师。只输出 HTML 文件内容。"},
                    {
                        "role": "user",
                        "content": PROMPT
                        + "\n\n=== 当前页面 HTML ===\n" + html
                        + "\n\n=== 数据模型 ===\n" + json.dumps(dm, ensure_ascii=False, indent=1),
                    },
                ],
                temperature=0.2,
            )
            out = strip_fences(r.content or "")
        except Exception as exc:  # noqa: BLE001
            print(f"[G2-{i+1}] 抛异常 {str(exc)[:150]}", flush=True)
            continue
        (OUT / f"G2_{i+1}.html").write_text(out, encoding="utf-8")
        c = {k: out.count(k) for k in ("data-head", "data-col", "data-rows", "data-fields", "data-cell", "data-action")}
        # 关键健康度：<th>/<td> 应该只剩模板那一个，留一堆就说明没收成清单驱动
        th, td = out.count("<th"), out.count("<td")
        print(f"[G2-{i+1}] {time.time()-t0:5.0f}s  {len(out):6d} 字符  绑定 {c}  剩余 <th>{th} <td>{td}", flush=True)
    print(f"\n产物在 {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
