"""第 2.5 步：按应用定设计语言（2026-08-15 晚）。

## 为什么链路里要多这一步

原来「起草规格」直接跳到「逐页画界面」，中间没有"这个应用长什么样"的环节——
不管什么业务出来都是同一个模子。参照的那批企业级后台之所以各有各的样子，
是因为每个产品先定了自己的设计语言。

## 分工：LLM 出判断，代码出格式

模型给的是好判断的东西（hex、枚举档位、组件名）；散文由 `render_design_language`
**确定性**渲染，DTCG 的颜色分量由 `to_dtcg` 从 hex 算。

⚠ 为什么不让模型直接写散文：那样覆盖就没法逐字段做，而且同一份输入每次
  渲染都不一样——同一个应用两次生成两种样子。
⚠ 为什么不让模型写 DTCG：`{"colorSpace":"srgb","components":[…],"hex":"…"}`
  里那三个分量必须跟 hex 自洽，模型写偏了**没有任何一处会报警**，
  颜色只是悄悄不对。这类"错了不响"的东西一律归代码。

## ⚠ 契约不经过这一步

本模块只出风格。它要是能写 <aside>、面包屑、Tailwind，LLM 一句
「去掉侧边导航」就能让 page_shell 抠不到壳，而整套外壳判据会静默全绿
（2026-08-15 当天栽过两次同型）。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.design_language import (  # noqa: E402
    DEFAULT_DESIGN_LANGUAGE,
    DENSITIES,
    build_design_language_prompt,
    generate_design_language,
    merge_override,
    normalize_design_language,
    render_design_language,
    to_dtcg,
)
from services.spec_page_html import build_page_html_prompt  # noqa: E402

SPEC = {
    "appName": "邻里药安",
    "pages": [
        {"id": "p1", "name": "经营监控看板", "purpose": "看当日销售与库存预警"},
        {"id": "p2", "name": "库存台账管理页", "purpose": "按批次管理效期"},
    ],
}

GOOD = {
    "tone": "克制的医疗后台，浅色底",
    "primary": "#0E7490",
    "accent": "#0F172A",
    "radius": "6px",
    "density": "紧凑",
    "components": ["状态标签", "进度条", "时间线"],
    "charts": True,
}


class Test收进封闭形状:
    def test_好的原样收下(self):
        d = normalize_design_language(GOOD)
        assert d["primary"] == "#0e7490" and d["density"] == "紧凑"
        assert d["components"] == ["状态标签", "进度条", "时间线"]

    @pytest.mark.parametrize("bad", ["蓝色", "#GGG", "#2563eb00", "", None, 123, "rgb(1,2,3)"])
    def test_颜色写不对就退缺省(self, bad):
        d = normalize_design_language({**GOOD, "primary": bad})
        assert d["primary"] == DEFAULT_DESIGN_LANGUAGE["primary"]

    def test_密度不在词表里就退缺省(self):
        assert normalize_design_language({"density": "超级紧凑"})["density"] == "标准"

    @pytest.mark.parametrize("d", DENSITIES)
    def test_词表内的都认(self, d):
        assert normalize_design_language({"density": d})["density"] == d

    def test_一个字段瞎写不牵连其它字段(self):
        """⚠ 逐字段兜底，不是整份丢：模型常常九个对一个瞎写，
        整份丢等于把对的九个也扔了。"""
        d = normalize_design_language({**GOOD, "radius": "很圆"})
        assert d["radius"] == DEFAULT_DESIGN_LANGUAGE["radius"]
        assert d["primary"] == "#0e7490", "一个字段坏了把别的也带走了"

    @pytest.mark.parametrize("junk", [None, "字符串", [], 42])
    def test_整个不是字典也不炸(self, junk):
        assert normalize_design_language(junk) == DEFAULT_DESIGN_LANGUAGE

    def test_组件去重并截断(self):
        d = normalize_design_language({"components": ["chip", "chip"] + [f"c{i}" for i in range(20)]})
        assert len(d["components"]) <= 8 and d["components"].count("chip") == 1


class Test渲染成散文:
    def test_确定性(self):
        """同一份输入渲染两次必须一模一样——否则同一个应用两次生成两种样子。"""
        assert render_design_language(GOOD) == render_design_language(GOOD)

    def test_关键字段都进散文(self):
        s = render_design_language(GOOD)
        for mark in ["克制的医疗后台", "#0e7490", "6px", "状态标签"]:
            assert mark in s

    def test_不要图表就不提图表(self):
        assert "图表" not in render_design_language({**GOOD, "charts": False})

    def test_没组件就不写那一行(self):
        assert "按内容需要用这些组件" not in render_design_language({**GOOD, "components": []})

    def test_空的也能渲染(self):
        assert render_design_language(None).strip()


class Test风格不许碰契约:
    """⚠ **本文件最要紧的一组**。"""

    @pytest.mark.parametrize("word", ["aside", "面包屑", "Breadcrumb", "Tailwind", "<header>"])
    def test_散文里不出现结构词(self, word):
        assert word not in render_design_language(GOOD)

    def test_提示词里不许诱导模型谈结构(self):
        msgs = build_design_language_prompt(SPEC)
        joined = " ".join(m["content"] for m in msgs)
        for word in ["aside", "面包屑", "Tailwind"]:
            assert word not in joined
        assert "只谈风格" in joined

    def test_回落提示词也要落到具体参照(self):
        """主路径走 style_brief；回落仍是 design_language。两条都要接。
        只改主路径 = 风格段一挂就退回形容词堆。把「具体参照」从回落提示词
        删掉本条必须红。
        """
        joined = " ".join(m["content"] for m in build_design_language_prompt(SPEC))
        assert "具体参照" in joined
        assert "不要只堆" in joined
        assert "#2563eb 当没想好时的退路" in joined
        assert "不是营销落地页" in joined
        assert "县域农技站" in joined
        assert "克制的企业后台" not in joined

    def test_缺省风格仍是fail_open那套蓝(self):
        """这一刀改提示词，不改挂了之后的兜底色。改 #2563eb 会让无 LLM
        的回落全站换皮。"""
        assert DEFAULT_DESIGN_LANGUAGE["primary"] == "#2563eb"
        assert DEFAULT_DESIGN_LANGUAGE["tone"] == "企业后台风格，浅色底"

    def test_注进槽位后契约仍在(self):
        """端到端：生成的风格塞进第 3 步的槽位，结构契约照旧由代码拼在后面。"""
        p = build_page_html_prompt("某页", design_system=render_design_language(GOOD))
        assert "克制的医疗后台" in p
        assert "<aside>" in p and 'aria-current="page"' in p


class Test覆盖:
    def test_逐字段盖(self):
        out = merge_override(normalize_design_language(GOOD), {"density": "宽松"})
        assert out["density"] == "宽松" and out["primary"] == "#0e7490"

    @pytest.mark.parametrize("empty", [None, {}])
    def test_没给覆盖就原样(self, empty):
        base = normalize_design_language(GOOD)
        assert merge_override(base, empty) == base

    def test_覆盖也要过一遍归一化(self):
        """⚠ 人也会写错。覆盖绕过校验的话，一个 '蓝色' 就能把颜色写坏，
        而它比模型写错更难查——因为"人写的"听起来像可信的。"""
        out = merge_override(normalize_design_language(GOOD), {"primary": "蓝色"})
        assert out["primary"] == DEFAULT_DESIGN_LANGUAGE["primary"]


class Test生成时挂了不打死整轮:
    """⚠ fail-open。这一步产出的是**审美**，挂了顶多难看；
    而整轮挂掉是把前面几分钟的 spec 一起烧了。

    这跟 spec_tree 那条"失败不回落占位"不矛盾：那条护的是**内容**
    （假需求树会骗过下游），这里回落的是审美，骗不了谁。
    """

    def test_模型抛错时回落缺省(self):
        def boom(_messages):
            raise RuntimeError("上游 502")

        assert generate_design_language(SPEC, llm_json_fn=boom) == DEFAULT_DESIGN_LANGUAGE

    def test_模型返回垃圾时回落缺省(self):
        assert generate_design_language(SPEC, llm_json_fn=lambda _m: None) == DEFAULT_DESIGN_LANGUAGE

    def test_模型半对时保住对的那半(self):
        out = generate_design_language(
            SPEC, llm_json_fn=lambda _m: {"primary": "#0e7490", "density": "乱写"}
        )
        assert out["primary"] == "#0e7490" and out["density"] == "标准"

    def test_底层调用抛错时也回落(self, monkeypatch):
        """⚠ **变异测试逼出来的一条**。

        上面那条"模型抛错"其实**没走到** generate_design_language 自己的
        try：`call_spec_json` 的文档写着"注入的 llm_json_fn 抛错按没产出处理"，
        它自己就吞了。所以把本模块的 except 换成 raise，四条用例一条都不红——
        看着在测 fail-open，实际测的是另一条路。

        这里直接让 call_spec_json 本身抛（导入失败、客户端崩这类真实形态）。
        """
        import services.spec_llm_call as sl

        def boom(*_a, **_kw):
            raise RuntimeError("客户端崩了")

        monkeypatch.setattr(sl, "call_spec_json", boom)
        assert generate_design_language(SPEC) == DEFAULT_DESIGN_LANGUAGE

    def test_挂了也照样能被覆盖(self):
        out = generate_design_language(
            SPEC, llm_json_fn=lambda _m: None, override={"density": "紧凑"}
        )
        assert out["density"] == "紧凑"


class Test导出DTCG:
    """W3C Design Tokens Format 2025.10（2025-10-28 首个稳定版）。"""

    def test_颜色分量由代码从hex算(self):
        t = to_dtcg({**GOOD, "primary": "#ffffff"})
        v = t["color"]["primary"]["$value"]
        assert v["components"] == [1.0, 1.0, 1.0] and v["hex"] == "#ffffff"
        assert v["colorSpace"] == "srgb" and v["alpha"] == 1

    def test_分量跟hex始终自洽(self):
        v = to_dtcg({**GOOD, "primary": "#0e7490"})["color"]["primary"]["$value"]
        assert v["components"][0] == pytest.approx(0x0E / 255, abs=1e-4)
        assert v["components"][2] == pytest.approx(0x90 / 255, abs=1e-4)

    def test_尺寸是规范的值单位对象(self):
        assert to_dtcg({**GOOD, "radius": "6px"})["radius"]["base"]["$value"] == {
            "value": 6, "unit": "px"
        }

    def test_组上带type_值节点带value(self):
        """规范：有 $value 的是 token，没有的是 group；$type 可以挂在组上继承。"""
        t = to_dtcg(GOOD)
        assert t["color"]["$type"] == "color" and "$value" not in t["color"]
        assert "$value" in t["color"]["primary"]


class Test接进链路:
    """⚠ 单测模块本身全绿、而它压根没被链路调用——这是本仓反复数到的形状
    （「闸全绿但功能没生效」）。所以这里钉**接线**。"""

    def _spec_first_src(self) -> str:
        import pathlib

        return (pathlib.Path(__file__).resolve().parents[1]
                / "services/spec_first_pipeline.py").read_text(encoding="utf-8")

    def test_链路里有第2_5步(self):
        src = self._spec_first_src()
        assert "specfirst.design" in src, "第 2.5 步没埋点，跑起来看不见它"
        assert "generate_design_language" in src and "render_design_language" in src

    def test_人给了散文就不调LLM(self):
        """⚠ 显式指定优先于生成——跟 on_page「显式实参优先于 sink」同一条纪律。
        省一次调用是顺带的，主要是别让生成结果覆盖人明确写下的东西。

        ⚠ 这条第一版钉的是 `if not (design_system or "").strip():` 这行**原文**，
          加了"复用上一版"那支之后条件重写成三岔，它当场红了——钉措辞的老毛病。
          现在钉的是次序：散文那支必须排在生成之前。
        """
        src = self._spec_first_src()
        prose = src.index('if (design_system or "").strip():')
        gen = src.index("generate_design_language(")
        assert prose < gen, "人给了散文却还是先跑生成"

    def test_设计语言随结果交出去(self):
        """存得下来，重跑/修补才能复用同一份——否则同一个应用每轮换个样子。"""
        assert '"designLanguage": design_language' in self._spec_first_src()

    def test_风格一路透到第3步(self):
        import inspect

        from services.spec_first_pipeline import run_spec_first
        from services.spec_page_html import generate_page_html, generate_pages_parallel

        for fn in (run_spec_first, generate_pages_parallel, generate_page_html):
            assert "design_system" in inspect.signature(fn).parameters, (
                f"{fn.__name__} 没接 design_system，风格传不到第 3 步"
            )


class Test落库与复用:
    """② 同一个应用重跑不许换配色（2026-08-15 晚）。

    ⚠ 真机量到的形状：同一份页面清单连着调两次第 2.5 步——

        第一次  primary=#1b3a57  accent=#a1824a   （深藏青 + 金棕）
        第二次  primary=#1e3a8a  accent=#b45309   （藏青 + 琥珀）

    气质同向、具体值全变。精修场景下用户只是让改一句话，界面颜色却整个换掉，
    **那是一眼可见的不稳定**，比密度不够伤得多。

    ⚠ 而更早的一版里我写过"designLanguage 存得下来能复用"——那是**半句真话**：
      字段确实在 run_spec_first 的返回值里，但唯一的调用方只取 result["model"]，
      **没有任何一处持久化它**。所以这次把它挂进 model：model 是唯一被落库
      （app_store.model_json）也是精修时回流（refine_ctx["model"]）的那份。
    """

    def _src(self, name: str) -> str:
        import pathlib

        return (pathlib.Path(__file__).resolve().parents[1]
                / f"services/{name}").read_text(encoding="utf-8")

    def test_挂进model才会被落库(self):
        """⚠ 钉在**落库那条路**上，不是钉在返回值里——返回值那份没人存。"""
        src = self._src("spec_first_pipeline.py")
        assert 'model["designLanguage"] = design_language' in src, (
            "设计语言没挂进 model，app_store 存的是 model_json，等于没落库"
        )

    def test_精修时把上一版带回去(self):
        src = self._src("v5_capability_executor.py")
        assert 'designLanguage' in src and "reuse_language=" in src, (
            "精修没沿用上一版设计语言，同一个应用每轮换个配色"
        )

    def test_复用时不再调LLM(self):
        """★ 复用的意义就在这——既省一次调用，更重要的是**结果稳定**。"""
        src = self._src("spec_first_pipeline.py")
        i = src.index("elif reuse_language:")
        j = src.index("else:", i)
        branch = src[i:j]
        assert "generate_design_language" not in branch, "复用分支里还在调生成"
        assert "render_design_language" in branch

    def test_复用的也过归一化(self):
        """⚠ 上一版可能是老格式、也可能被人手工改坏过。存进来的不等于可信的。"""
        src = self._src("spec_first_pipeline.py")
        i = src.index("elif reuse_language:")
        assert "normalize_design_language" in src[i:src.index("else:", i)]

    def test_人给的散文仍然最高优先(self):
        """三层优先级：散文 > 复用 > 生成。散文那支要在最前面。"""
        src = self._src("spec_first_pipeline.py")
        a = src.index('if (design_system or "").strip():')
        b = src.index("elif reuse_language:")
        c = src.index("raise_if_cancelled(\"第2.5步 定设计语言\")")
        assert a < b < c

    def test_复用之上还能再覆盖(self):
        """沿用上一版、但这次想把密度调紧——两者要能叠。"""
        base = normalize_design_language(GOOD)
        out = merge_override(base, {"density": "宽松"})
        assert out["density"] == "宽松" and out["primary"] == base["primary"]


class Test密度档位要展开成具体条款:
    """① 只写"信息密度标准"四个字，模型推不出该画什么（2026-08-15 晚）。

    ⚠ 三次对照量出来的：

        A 旧提示词（一句话）                 字符 16892/页  面板 16.7  右侧栏 0/3
        B 硬写死密度条款（统计卡/面板/列数）  字符 25838/页  面板 22.3  右侧栏 3/3
        C 换成生成的设计语言（只给档位词）    字符 18748/页  面板 17.8  右侧栏 0/4

    B 涨的那 53% **全来自具体条款**，不是来自"密度"这个词；C 把条款撤掉、
    只留档位词，密度当场掉回去。

    所以分工是：**档位是模型的判断，档位具体意味着什么是代码的事**——
    跟 DTCG 那条同源（模型给 hex，分量由代码算）。这样既没把风格写死
    （模型仍可选三档、人也能覆盖），又不让"密度"变成一句空话。
    """

    def _render(self, density: str) -> str:
        return render_design_language({**GOOD, "density": density})

    @pytest.mark.parametrize("density", DENSITIES)
    def test_每一档都有具体条款(self, density):
        s = self._render(density)
        assert "统计卡" in s and "面板" in s and "表格" in s, f"{density} 档没展开"

    def test_三档展开得不一样(self):
        outs = {d: self._render(d) for d in DENSITIES}
        assert len(set(outs.values())) == 3, "三档渲染出同一段话，等于档位没起作用"

    def test_越紧凑要求越多(self):
        """⚠ 方向要对。第一版有可能把区间抄反而没人发现——数值单调是能机械判的。"""
        import re

        def first_num(s: str) -> int:
            return int(re.search(r"统计卡（(\d+)", s).group(1))

        assert first_num(self._render("紧凑")) > first_num(self._render("宽松"))

    def test_表格列数也跟着档位走(self):
        assert "8 列" in self._render("紧凑")
        assert "6 列" in self._render("标准")

    def test_展开的条款里没有结构词(self):
        """⚠ 密度是风格，不许借机把契约那半塞进来。"""
        for d in DENSITIES:
            s = self._render(d)
            for word in ["aside", "面包屑", "Tailwind", "<header>"]:
                assert word not in s

    def test_渲染仍然是确定性的(self):
        assert self._render("紧凑") == self._render("紧凑")


class Test手机密度条款:
    """回落支（LLM 风格段挂了）也必须按竖屏展开，不能复用「后台 + 6 列宽表」。"""

    def test_phone不写宽表后台(self):
        s = render_design_language(GOOD, device="phone")
        assert "手机竖屏 App" in s
        assert "单列" in s
        assert "不要左右分栏" in s
        assert "主表格至少" not in s
        assert "这是给天天用它干活的人看的后台" not in s

    def test_desktop仍是后台宽表(self):
        s = render_design_language(GOOD)
        assert "后台" in s
        assert "8 列" in s
        assert "手机竖屏 App" not in s

    def test_phone提示词不写成企业后台(self):
        joined = " ".join(m["content"] for m in build_design_language_prompt(SPEC, device="phone"))
        assert "手机竖屏 App" in joined
        assert "移动端产品设计师" in joined
        assert "B 端产品设计师" not in joined
        assert "克制的企业后台" not in joined
