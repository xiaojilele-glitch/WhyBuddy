# -*- coding: utf-8 -*-
"""走 LLM 的路径，token 预算不许写死——全链路只有一个 `LLM_MAX_TOKENS`。

## 这条闸是怎么来的（三次同一个病）

**第一次（生成路径）**：`v5_llm_generate` 写死 8000。推理模型的思考 token 和
正文**共用同一个 max_tokens**，8000 全被思考吃光，正文一个字都没有，
`finish_reason=length`，客户端收到的是 `empty content from LLM (stream)`。
那句错误看着像"服务商坏了"——**这正是它危险的地方**：换模型的人会去查网关、
查网络、怀疑 key，而不会想到调 max_tokens。修法：提到 8000 + 加个专属环境变量。

**第二次（轮内能力）**：同一个病换个地方发作。线上跑一道真题，`intent.clarify`
占着连接算了 115.5 秒、正文一个字没吐，整轮被它一个人从 22 秒拖到 116 秒
（并行批的耗时等于最慢那个），最后还得回退 RAG——产出也打了折。真因是预算
写死在 `execute_capability(max_tokens: int = 2000)` 的**函数签名默认值**里：
没有名字、搜不到、也没人会想起它跟模型换代有关。修法：再加一个专属环境变量。

**第三次（换 DeepSeek）**：前两个专属环境变量都调大了，挂掉的却是它俩都管不着
的**第三处**——`freeform_block` 里写死的 14000，思考吃光，整个首页设计失败，
3 次重试全一样，白烧 433.8 秒。

## 所以这次改的是形态，不是数字

前两次的修法（"加一个有名字的专属旋钮"）本身就是病因：**旋钮越多，漏的越多。**
一次全库扫下来 26 处写死的预算，分布在调用点和签名默认值里，其中
`client.py` 的 `max_tokens: int = 2000` 是最深的一处——凡是没显式传参的调用点
全被它按在 2000，谁都看不见。

现在全链路一个 `LLM_MAX_TOKENS`（默认 65535，见 `config.DEFAULT_MAX_TOKENS`）：

- 写死的预算**一处都不许留**（本文件的 AST 扫描是判据，不是靠 grep 靠自觉）；
- 分路旋钮 `LLM_GENERATE_MAX_TOKENS` / `LLM_ROUND_CAP_MAX_TOKENS` **已删**，
  且钉住"删干净了"——留着它们比没有更糟：旧 .env 里一个
  `LLM_ROUND_CAP_MAX_TOKENS=32000` 会让那条路悄悄比全局窄，正是要根除的形态。

数字该多大是产品决定（花钱），但"藏起来的预算"不该再发生第四次。
"""

import ast
import inspect
from pathlib import Path

import pytest

from sliderule_llm import capabilities as caps
from sliderule_llm.config import (
    DEFAULT_MAX_TOKENS,
    WIRE_MAX_OUTPUT_TOKENS,
    clamp_max_tokens,
    default_max_tokens,
    resolve_wire_max_tokens,
    wider_output_budget,
)

_PY_ROOT = Path(__file__).resolve().parent.parent
_LLM_DIR = _PY_ROOT / "sliderule_llm"

#: 扫描范围：所有会真的发 LLM 请求的生产代码。tests/ 自己排除——单测靠显式
#: 传小值控成本是正当的（见 `test_显式传值仍然优先`）。
_SCANNED_DIRS = ("sliderule_llm", "services", "routes", "scripts")


def _hardcoded_budget_sites() -> list[str]:
    """全库找写死的 max_tokens。

    用 AST 不用正则：正则看不见 `max_tokens: int = 2000` 这种**签名默认值**
    （第二次和第三次栽的就是它），还会把注释和提示词里的字面量当成命中。
    """
    sites: list[str] = []
    for folder in _SCANNED_DIRS:
        for path in sorted((_PY_ROOT / folder).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            rel = path.relative_to(_PY_ROOT)
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    for kw in node.keywords:
                        if kw.arg == "max_tokens" and isinstance(kw.value, ast.Constant) and isinstance(
                            kw.value.value, int
                        ):
                            sites.append(f"{rel}:{kw.value.lineno} 调用点写死 {kw.value.value}")
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    a = node.args
                    groups = (
                        (a.args, a.defaults, len(a.args) - len(a.defaults)),
                        (a.kwonlyargs, a.kw_defaults, 0),
                    )
                    for names, defaults, offset in groups:
                        for i, default in enumerate(defaults):
                            if default is None:
                                continue
                            if names[i + offset].arg == "max_tokens" and isinstance(
                                default, ast.Constant
                            ) and isinstance(default.value, int):
                                sites.append(
                                    f"{rel}:{default.lineno} 签名默认值写死 {default.value}"
                                )
    return sites


class Test全链路只有一个旋钮:
    def test_没有任何写死的预算(self):
        sites = _hardcoded_budget_sites()
        assert not sites, (
            "又出现写死的 token 预算了：\n  "
            + "\n  ".join(sites)
            + "\n\n改成 default_max_tokens()（调用点）或 `max_tokens: int | None = None`"
            "（签名，让下游兜底）。理由见本文件头——这个病已经犯过三次。"
        )

    def test_默认不设限(self, monkeypatch):
        """2026-09-19：不设环境变量就是不带 max_tokens，不是偷偷写成 65535。"""
        monkeypatch.delenv("LLM_MAX_TOKENS", raising=False)
        assert default_max_tokens() is None
        assert resolve_wire_max_tokens(None) is None
        assert WIRE_MAX_OUTPUT_TOKENS == DEFAULT_MAX_TOKENS == 65535

    def test_65536会被钳住(self, monkeypatch):
        monkeypatch.setenv("LLM_MAX_TOKENS", "65536")
        assert default_max_tokens() == 65535
        assert clamp_max_tokens(65536) == 65535

    def test_发出去之前也钳(self):
        """只改 default 不够：显式传入 65536 仍会 400。钳必须在出网口。

        剥注释再匹配：标识符写在 docstring 里、调用删掉，判据会假绿。
        """
        import re

        import sliderule_llm.client as client
        import sliderule_llm.config as config

        def _code(fn):
            src = re.sub(r'""".*?"""', "", inspect.getsource(fn), flags=re.S)
            return re.sub(r"#.*", "", src)

        once = _code(client._call_llm_once)
        stream = _code(client._call_llm_once_streaming)
        assert "resolve_wire_max_tokens" in once
        assert "resolve_wire_max_tokens" in stream
        assert "clamp_max_tokens" in _code(config.resolve_wire_max_tokens)

    def test_环境变量能覆盖(self, monkeypatch):
        monkeypatch.setenv("LLM_MAX_TOKENS", "32000")
        assert default_max_tokens() == 32000

    @pytest.mark.parametrize("bad", ["", "   ", "32k", "abc", "0", "-1", "unlimited", "none"])
    def test_写坏了或不设限标记都不崩(self, monkeypatch, bad):
        # 这类开关最怕"配错一个字符就整场炸"——推演挂掉比省略字段糟得多。
        # 空串是 compose 的 ${VAR:-default} 传进来的常见形态，别让它变成 0。
        monkeypatch.setenv("LLM_MAX_TOKENS", bad)
        assert default_max_tokens() is None

    def test_不设限比任何数字都宽(self):
        assert wider_output_budget(2000, None) is None
        assert wider_output_budget(None, 65535) is None
        assert wider_output_budget(2000, 8000) == 8000

    def test_现读环境变量_不做模块级常量(self, monkeypatch):
        """评测脚本改完环境变量要立刻生效，不能等重启进程。"""
        monkeypatch.setenv("LLM_MAX_TOKENS", "12345")
        assert default_max_tokens() == 12345
        monkeypatch.setenv("LLM_MAX_TOKENS", "23456")
        assert default_max_tokens() == 23456

    @pytest.mark.parametrize(
        "retired", ["LLM_GENERATE_MAX_TOKENS", "LLM_ROUND_CAP_MAX_TOKENS"]
    )
    def test_分路旋钮删干净了(self, retired):
        """留着分路值比没有更糟：旧 .env 里的一个小数字会让那条路悄悄比全局窄，
        而那正是这次要根除的形态（三次事故里有两次是"某条路的预算特别小"）。

        判据钉在**字面量**上，不是"文件里出现过这个词"：注释里的墓碑
        （"这个变量已经删了，别再加回来"）是要留的，读它才是要禁的。
        AST 里没有注释，正好分得开。
        """
        offenders: list[str] = []
        for folder in _SCANNED_DIRS:
            for path in sorted((_PY_ROOT / folder).rglob("*.py")):
                for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                    if isinstance(node, ast.Constant) and node.value == retired:
                        offenders.append(f"{path.relative_to(_PY_ROOT)}:{node.lineno}")
        assert not offenders, f"{retired} 已经废弃，但还有人读它：{offenders}"


class Test预算不写死在签名里:
    def test_轮内能力(self):
        default = inspect.signature(caps.execute_capability).parameters["max_tokens"].default
        assert default is None, (
            f"max_tokens 的默认值又变回写死的 {default!r} 了。"
            "签名里只留 None，实际值走 default_max_tokens()——理由见本文件头。"
        )

    def test_客户端三个入口(self):
        """`client.py` 是最深的一层：调用点不传 max_tokens 时由它兜底。
        它以前写死 2000，等于给全链路设了一个谁都看不见的天花板。"""
        from sliderule_llm import client

        for name in ("_call_llm_once", "_call_llm_once_streaming", "call_llm"):
            fn = getattr(client, name)
            assert inspect.signature(fn).parameters["max_tokens"].default is None, (
                f"client.{name} 的 max_tokens 又有写死的默认值了"
            )

    def test_显式传值仍然优先(self):
        """评测脚本和单测靠显式传值控制成本，不能被默认值吃掉。"""
        seen = {}

        def fake_caller(messages, **kwargs):
            seen.update(kwargs)

            class R:
                content = "内容"
                model = "m"
                usage = None

            return R()

        caps.execute_capability(
            {"capabilityId": "risk.analyze", "goal": "某目标"}, caller=fake_caller, max_tokens=123
        )
        assert seen.get("max_tokens") == 123

    def test_不传就用全局配置值(self, monkeypatch):
        monkeypatch.setenv("LLM_MAX_TOKENS", "4321")
        seen = {}

        def fake_caller(messages, **kwargs):
            seen.update(kwargs)

            class R:
                content = "内容"
                model = "m"
                usage = None

            return R()

        caps.execute_capability({"capabilityId": "risk.analyze", "goal": "某目标"}, caller=fake_caller)
        assert seen.get("max_tokens") == 4321

    def test_不设环境变量能力调用也不传上限(self, monkeypatch):
        monkeypatch.delenv("LLM_MAX_TOKENS", raising=False)
        seen = {}

        def fake_caller(messages, **kwargs):
            seen.update(kwargs)

            class R:
                content = "内容"
                model = "m"
                usage = None

            return R()

        caps.execute_capability({"capabilityId": "risk.analyze", "goal": "某目标"}, caller=fake_caller)
        assert seen.get("max_tokens") is None


class Test空内容报错必须说清为什么:
    """**差一个 finish_reason，"预算不够"和"服务商挂了"长得一模一样。**

    信息一直在手上（`finish` 就在同一个函数里，成功路径还会塞进 LlmResult），
    只是没写进错误消息，于是排查方向整个偏到上游去。
    """

    def test_finish_reason_进了错误消息(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("length", 2000, {"completion_tokens": 2000})
        assert "finish_reason=length" in msg
        assert "max_tokens=2000" in msg

    def test_预算吃光时给出可执行的下一步(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("length", 2000, None)
        assert "不是服务商故障" in msg, "没说清是预算问题，读的人还是会去查上游"
        assert "LLM_MAX_TOKENS" in msg, "得告诉人改哪个旋钮"

    def test_不是预算问题时不乱扣帽子(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("stop", 8000, None)
        assert "预算被吃光" not in msg, "finish_reason=stop 却说是预算问题，是在误导"

    def test_两处空内容报错都带上了提示(self):
        """非流式和流式**两条路**都要带——线上跑的是流式那条，
        但换个 wire_api 就走另一条，只补一半等于没补。"""
        import re

        src = (_LLM_DIR / "client.py").read_text(encoding="utf-8")
        raises = re.findall(r'raise LlmError\(\s*\n?\s*f?"empty content from LLM[^"]*"', src)
        assert len(raises) >= 2, f"只找到 {len(raises)} 处空内容报错，预期两条路都在"
        for site in raises:
            assert site.lstrip("raise LlmError(").lstrip().startswith("f"), (
                f"这处空内容报错还是死字符串，没带 finish_reason：{site}"
            )


class Test推理档位只有一个来源:
    """`reasoning_effort` 一律走 .env 的 `LLM_REASONING_EFFORT`，代码里不许写死。

    这条和上面 `max_tokens` 那组是同一条纪律，不是两条：**旋钮越多，漏的越多。**

    这个病在 max_tokens 上犯过三次（见文件头），每次的"修法"都是再加一个分路
    旋钮，而每次挂掉的都是新旋钮管不着的第三处。档位上差点走同一条路：
    2026-08-13 全局降 low 把首页设计跑挂（`5 validation errors ... tag Field
    required`，思考砍到中位数 12 token），当时的处置是给结构化生成单独定一个
    medium 的默认档位。全局回到 medium 之后那个默认值就只剩风险——谁把 .env 调到
    high，最吃思考的那条路会被它悄悄按回 medium，症状还是静默的深层 JSON 校验
    失败，和当初 low 跑挂首页一模一样。所以删掉，只留 .env 一个来源。

    判据钉在**字面量**上：注释里的墓碑（"这里曾经写死过 low，别再加回来"）是要
    留的，真的传参才是要禁的。AST 里没有注释，正好分得开。
    """

    #: 允许保留的档位来源。都是"provider 自己的那份 .env 配置"，不是分路旋钮：
    #: cfg.reasoning_effort 是主配置（LLM_REASONING_EFFORT），
    #: fallback.* 是回落 provider 的（FALLBACK_LLM_REASONING_EFFORT）——
    #: 回落是**另一家服务商**，它有自己的一份 .env，不是同一条路上的分路值。
    _ALLOWED_SOURCES = (
        "cfg.reasoning_effort",
        "fallback.reasoning_effort",
        "_pick('FALLBACK_LLM_REASONING_EFFORT')",
    )

    def test_没有写死的档位(self):
        offenders: list[str] = []
        for folder in _SCANNED_DIRS:
            for path in sorted((_PY_ROOT / folder).rglob("*.py")):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in ast.walk(tree):
                    if not isinstance(node, ast.Call):
                        continue
                    for kw in node.keywords:
                        if kw.arg != "reasoning_effort":
                            continue
                        # 字符串字面量 = 写死了；None / 变量 = 跟配置走
                        if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                            offenders.append(
                                f"{path.relative_to(_PY_ROOT)}:{kw.value.lineno} "
                                f"reasoning_effort={kw.value.value!r}"
                            )
        assert not offenders, (
            "又有人在代码里写死推理档位了：\n  "
            + "\n  ".join(offenders)
            + "\n\n删掉这个参数，让它跟 .env 的 LLM_REASONING_EFFORT 走。"
            "理由见本文件头与 config.py 那块墓碑——这个病在 max_tokens 上犯过三次。"
        )

    @pytest.mark.parametrize(
        "retired", ["LLM_STRUCTURED_REASONING_EFFORT", "DEFAULT_STRUCTURED_REASONING_EFFORT"]
    )
    def test_分路旋钮删干净了(self, retired):
        """留着分路值比没有更糟：旧 .env 里一个
        `LLM_STRUCTURED_REASONING_EFFORT=low` 会让最吃思考的那条路悄悄比全局低。"""
        offenders: list[str] = []
        for folder in _SCANNED_DIRS:
            for path in sorted((_PY_ROOT / folder).rglob("*.py")):
                for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                    if isinstance(node, ast.Constant) and node.value == retired:
                        offenders.append(f"{path.relative_to(_PY_ROOT)}:{node.lineno}")
                    if isinstance(node, ast.Name) and node.id == retired:
                        offenders.append(f"{path.relative_to(_PY_ROOT)}:{node.lineno}")
        assert not offenders, f"{retired} 已经废弃，但还有人读它：{offenders}"

    def test_档位来源只剩配置对象(self):
        """扫一遍还在传这个参数的地方，确认传的都是配置对象的字段。

        这条比上面那条严：写死的字面量固然要禁，但"从别处算一个档位出来"也是
        第二个来源。目前只该有主配置和回落 provider 各自的那份 .env 值。
        """
        sources: set[str] = set()
        for folder in _SCANNED_DIRS:
            for path in sorted((_PY_ROOT / folder).rglob("*.py")):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in ast.walk(tree):
                    if not isinstance(node, ast.Call):
                        continue
                    for kw in node.keywords:
                        if kw.arg != "reasoning_effort":
                            continue
                        if isinstance(kw.value, ast.Constant) and kw.value.value is None:
                            continue  # None = 不覆盖，跟配置走
                        if isinstance(kw.value, ast.Name):
                            continue  # 透传上游形参
                        sources.add(ast.unparse(kw.value))
        assert sources <= set(self._ALLOWED_SOURCES), (
            f"出现了新的档位来源：{sorted(sources - set(self._ALLOWED_SOURCES))}。"
            "档位只该来自 .env——新增来源前先读 config.py 那块墓碑。"
        )

    def test_模板里全局不是_low(self):
        """.env.example 是新部署的默认值。low 省的是思考量，也就是产出正确率
        （实测把首页设计跑挂，3 次尝试全是 `tag Field required`）。"""
        import re

        text = (_PY_ROOT.parent / ".env.example").read_text(encoding="utf-8")
        values = re.findall(r"^LLM_REASONING_EFFORT=(.*)$", text, re.MULTILINE)
        assert values, "模板里找不到 LLM_REASONING_EFFORT"
        for value in values:
            assert value.strip().lower() != "low", (
                "模板把全局推理档位配成了 low：它快一倍，但快出来的那一半是从产出里省的。"
            )
