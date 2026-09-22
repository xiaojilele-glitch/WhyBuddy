# -*- coding: utf-8 -*-
"""架构边界闸：这是我们的「编译器」。

## 为什么有这个文件

2026-08-29 对照 grok-build（`docs/欠缺模块清单-对照Claude与Grok-build.md` §16）：

    grok-build   架构图 0 张。91 个 crate 在 Cargo.toml 里显式声明依赖，
                 347 条边由**编译器**强制；循环依赖在 Rust 里编译不出来。
    WhyBuddy     架构图 17 张全手画，265 个模块 394 条边**零强制**。

手画的后果量到过：已知缺口图六条里四条早就不成立、19 个模块块有 12 个从没画过。
代码这边同样飘：62% 的内部 import 写在函数体里（绕环的标准手法），5 个真的环。

**他们的架构图是编译器画的，我们的是人画的。** 这个文件补的就是那个编译器。

## 三条判据，各挡一件事

    未声明的跨包依赖变多   → 红（对应「没声明就编译不过」）
    新增循环依赖           → 红（对应「循环依赖编译不出来」）
    图与代码不同步         → 红（对应「根 Cargo.toml 是生成的」）

第三条是用户真正要的那条：**多台电脑改了代码不重新生成，图就不一致**。
判据把「重新生成一遍，看看和仓里那份一不一样」变成机器的事。

## ⚠ 这道闸自己也得咬得住

本仓 2026-08-29 刚数过一轮「闸装上了 ≠ 闸咬得动」（§14）。所以这里每条判据
都配了变异验证，而且第一条判据是**扫描器自己没瞎**——写 arch_graph 的第一版
就把 472 个测试文件算进了依赖图（`"tests/" in str(p)` 匹配不到 `tests/foo.py`，
因为没有前导斜杠），噪音把真信号整个盖住。
"""

import os
import pathlib
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import arch_graph  # noqa: E402

_G = arch_graph.build_graph()
_M = arch_graph.load_manifest()
_COMP = arch_graph.component_of(_M)


class Test扫描器自己没瞎:
    """⚠ 排第一。扫描集不对，下面三条全是绿灯空过。"""

    def test_包名单是从代码派生的_不是手写的(self):
        """⚠ 2026-08-29 手工发现的漏筛，两个盲区叠在一起。

        `PACKAGES` 原来是手写的，而它同时被当成两样东西用：
        `_resolve` 里「哪些 import 算内部边」的筛子，和 `_pkg_of` 的分类器。
        名单里漏了顶层的 `stdio_utf8`，于是：

          1. `app.py:24` 那句**顶层** `from stdio_utf8 import ...` 在图里不存在，
             `stdio_utf8` 反而以"零入度、没人用"的样子躺在孤儿名单里；
          2. 就算边补出来，`_pkg_of` 给它打 `"?"`，而 `layer_violations`
             见 `"?"` 会把整条边跳过——**边在，闸看不见**。

        一并浮出水面的 `complete_migration -> models / services` 两条边，
        在此之前从来没被任何一道闸看见过。

        这条判据钉的是：**每一个被扫到的模块，它的包都得是真实存在的包**，
        而且不许再出现 `"?"` 这种"分不出类就当没看见"的出口。
        """
        roots = {m.split(".")[0] for m in _G.modules}
        # 种子名单只是兜底，派生结果必须把它全包住——少了说明扫描范围缩了
        assert set(arch_graph._SEED_PACKAGES) <= roots, (
            f"种子包名单里有派生不出来的：{sorted(set(arch_graph._SEED_PACKAGES) - roots)}"
        )
        # 反向：派生出来但没声明的包，闸压根管不到它
        declared = set(_M.get("layer", {}))
        assert roots <= declared, (
            f"这些包在代码里存在却没在 architecture.toml 声明，闸管不到它们："
            f"{sorted(roots - declared)}"
        )
        for m in sorted(_G.modules):
            assert arch_graph._pkg_of(m) != "?", (
                f"{m} 分不出包——带 '?' 的边会被 layer_violations 整条跳过，"
                f"等于这个模块的依赖对闸隐形"
            )

    def test_顶层单文件模块的import也算边(self):
        """⚠ 上面那条的行为版。只查 `_pkg_of` 不出 '?' 的话，
        「边根本没被扫出来」这一半照样绿——那正是当时的实际情况。"""
        edges = {f"{e.src} -> {e.dst}" for e in _G.edges}
        assert "app -> stdio_utf8" in edges, (
            "app.py 顶层那句 `from stdio_utf8 import configure_stdio_utf8` "
            "没被扫成边——包名单又变回手写筛子了"
        )

    def test_扫到的是产线代码不是测试(self):
        assert _G.files_scanned > 200, f"只扫到 {_G.files_scanned} 个文件，判据会空过"
        assert not any(m.startswith("tests.") for m in _G.modules), (
            "测试文件被算进依赖图了——第一版就栽在这（路径是 tests/foo.py，"
            "没有前导斜杠，`\"tests/\" in str(p)` 匹配不到）"
        )

    def test_核心模块都在图里(self):
        for m in ("services.v5_full_driver", "routes.sliderule_full",
                  "services.spec_first_pipeline"):
            assert m in _G.modules, f"{m} 不在图里，扫描范围漏了"

    def test_函数体里的import也算数(self):
        """⚠ 全仓 62% 的 import 在函数体里。不算 = 默认放行三分之二的依赖，
        而且给了一句话绕过闸的办法：把 import 挪进函数。"""
        deferred = sum(1 for e in _G.edges if e.deferred)
        assert deferred > 100, f"只认出 {deferred} 条函数体内 import，解析器坏了"
        assert any(
            e.deferred and e.src.startswith("services.") for e in _G.edges
        ), "services 里一条函数体内 import 都没认出来"


class Test依赖必须先声明:
    """对应 grok 的「没声明就编译不过」。"""

    def test_没有新增的未声明依赖(self):
        now = set(arch_graph.layer_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("violations", []))
        new = sorted(now - base)
        assert not new, (
            f"新增了未声明的跨包依赖：{new}。\n"
            f"要么改代码别这么依赖，要么在 architecture.toml 的 may_depend_on 里"
            f"**显式声明**（并写清为什么）。不许直接塞进 baseline。"
        )

    def test_基线只许变短(self):
        """⚠ 反向判据：棘轮不能倒着转。基线里躺着已经修好的条目，
        下一个人会以为那笔欠账还在。"""
        now = set(arch_graph.layer_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("violations", []))
        stale = sorted(base - now)
        assert not stale, (
            f"这些欠账已经还清了，从 architecture.toml 的 baseline 里删掉：{stale}"
        )

    def test_声明了却没有边的组间依赖要清掉(self):
        """⚠ 反向判据。2026-08-29 手工发现的漏筛：还完三条组间边之后，
        `architecture.toml` 里那三条 `may_depend_on` 还留着，闸一声不吭——
        它只查「用了没声明」，从来不查「声明了没用」。

        留着过期声明有两个真代价：下一个人以为那条依赖还在（照着它写新代码），
        以及**它是一张空白支票**——哪天真长出这条边来，闸会直接放行。
        跟 `test_例外必须真的存在于代码里` 是同一条纪律的组级版本。
        """
        comps = _M.get("component", {})
        assert comps, "architecture.toml 没有 component 声明，判据会空过"
        real = {(_COMP.get(e.src), _COMP.get(e.dst)) for e in _G.edges}
        stale = sorted(
            f"{name} -> {dep}"
            for name, spec in comps.items()
            for dep in spec.get("may_depend_on", [])
            if (name, dep) not in real
        )
        assert not stale, (
            f"这些组间依赖声明了却没有任何一条边对应，从 architecture.toml 删掉：{stale}"
        )

    def test_分层声明本身是自洽的(self):
        """⚠ 反向判据：声明里不许出现不存在的层，也不许自己依赖自己。"""
        layers = _M.get("layer", {})
        assert layers, "architecture.toml 没有 layer 声明，判据会空过"
        for name, spec in layers.items():
            for dep in spec.get("may_depend_on", []):
                assert dep in layers, f"{name} 声明依赖了不存在的层 {dep}"
                assert dep != name, f"{name} 声明依赖了自己"


class Test循环依赖只许变少:
    """对应 grok 的「循环依赖编译不出来」。Rust 里编译器管，Python 得自己数。"""

    def test_没有新增的环(self):
        # ⚠ 口径是**跨 component**：同一个「crate」内部互指是允许的（见
        #   Test同一个crate内部允许互指）。三处（CLI / 这里 / 生成的图）必须同口径，
        #   少算一项就会误报，而误报的闸下一个人会直接注释掉。
        now = set(arch_graph.cyclic_edges(_G, _M))
        base = set(_M.get("baseline", {}).get("cyclic_edges", []))
        new = sorted(now - base)
        assert not new, (
            f"新增了循环依赖：{new}。\n"
            f"Python 不会因此报错——它会让你把 import 挪进函数体里继续跑，"
            f"然后在某次 reload 或某个新入口上炸。"
        )

    def test_基线里的环还在_修好了就删掉(self):
        now = set(arch_graph.cyclic_edges(_G, _M))
        base = set(_M.get("baseline", {}).get("cyclic_edges", []))
        stale = sorted(base - now)
        assert not stale, (
            f"这些环已经拆掉了，从 architecture.toml 的 baseline 里删掉：{stale}"
        )

    def test_环的签名是规范化的(self):
        """⚠ 同一个环换个起点就成了「新环」的话，棘轮基线会被自己搅乱。"""
        for c in arch_graph.find_cycles(_G):
            members = c.split(" -> ")
            assert members[0] == members[-1], f"环签名没闭合：{c}"
            assert members[0] == min(members[:-1]), f"环签名没从最小成员起转：{c}"


class Test图与代码同步:
    """⚠ 用户要的正是这一条：**多台电脑改了代码不重新生成，图就不一致**。

    对应 grok 的「根 Cargo.toml 是生成的，treat it as read-only」。
    """

    def test_仓里那份图就是现在重新生成的那份(self):
        assert arch_graph.DIAGRAM.exists(), (
            f"{arch_graph.DIAGRAM} 不在——跑 "
            f"`python slide-rule-python/arch_graph.py --emit` 生成"
        )
        want = arch_graph.render_doc(_G, _M)
        got = arch_graph.DIAGRAM.read_text(encoding="utf-8")
        assert got == want, (
            "架构图和代码对不上了。**不要手改那个文件**，跑：\n"
            "  slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit"
        )

    def test_生成是确定性的(self):
        """⚠ 不确定就等于没修：两台电脑生成的文件不一样，判据每次都红，
        下一个人就会把它注释掉——而「多台电脑不一致」正是要治的病。"""
        a = arch_graph.render_doc(arch_graph.build_graph(), _M)
        b = arch_graph.render_doc(arch_graph.build_graph(), _M)
        assert a == b, "同一份代码生成了两份不同的图"

    def test_图上标着不许手改(self):
        head = arch_graph.DIAGRAM.read_text(encoding="utf-8")[:400]
        assert "不要手改" in head, "生成的图必须自己声明是生成的，否则一定有人手改它"


class Test闸能被真的绕过吗:
    """⚠ 反向判据：想清楚这道闸挡不住什么，写下来，别让人以为它全包。"""

    def test_动态import挡不住_已知边界(self):
        """`importlib.import_module("services.x")` 这类动态 import 是 AST 看不见的。

        这不是缺陷，是**边界**：写下来，免得下一个人以为这道闸全包。
        真要挡，得上运行时钩子，代价另算。
        """
        src = (arch_graph.ROOT / "arch_graph.py").read_text(encoding="utf-8")
        assert "import_module" not in src.split('"""')[2], (
            "如果哪天支持了动态 import，把这条判据改掉"
        )

    def test_命令行闸与判据同源(self):
        """⚠ CI 跑 `--check`，本地跑 pytest，两条路必须给同一个答案——
        否则就是本仓第四条：同一件事两个实现，改一个不改另一个。"""
        r = subprocess.run(
            [sys.executable, str(arch_graph.ROOT / "arch_graph.py"), "--check"],
            capture_output=True, text=True, encoding="utf-8",
        )
        errors = arch_graph.validate_graph(_G, _M)
        clean = not errors
        assert (r.returncode == 0) == clean, (
            f"命令行闸与 pytest 判据结论不一致：exit={r.returncode} clean={clean}\n{r.stdout}"
        )

    def test_共享完整闸通过(self):
        assert arch_graph.validate_graph(_G, _M) == []


class Test叶子层不许碰上层:
    """抄 grok 的叶子 crate：他们把 51 个共用工具切成独立 crate，依赖方向由
    编译器焊死——大块能用叶子，叶子永远碰不到大块。

    我们 195 个 services 模块平铺在一个命名空间里，谁都能 import 谁，
    **这正是「463 条 import 藏在函数体里」的根**：放文件头会循环导入，只好挪进
    函数体。分层之后方向被钉住，环没地方长，import 才有可能挪回文件头。

    ⚠ 分层是从今天的真实依赖深度算出来的（棘轮基线），不是重新设计。
      所以今天只有 1 条越层——闸的价值在**从今往后**，不在此刻抓到多少。
    """

    def test_分层声明覆盖了每个services模块(self):
        """⚠ 先钉住覆盖率：漏掉的模块不受任何约束，而判据看不出来。"""
        spec = _M.get("services_layer", {})
        assert spec, "architecture.toml 没有 services_layer 声明"
        declared = {m for cfg in spec.values() for m in cfg.get("modules", [])}
        actual = {m for m in _G.modules if m.startswith("services.")}
        missing = sorted(actual - declared)
        assert not missing, (
            f"这些 services 模块没落进任何一层，等于不受约束：{missing[:8]}"
            f"（共 {len(missing)} 个）。新模块要落进 util / core / flow 之一。"
        )

    def test_没有模块被分进两层(self):
        """⚠ 反向判据：一个模块在两层里，闸的结论就取决于遍历顺序。"""
        spec = _M.get("services_layer", {})
        seen: dict = {}
        dup = []
        for layer, cfg in spec.items():
            for m in cfg.get("modules", []):
                if m in seen:
                    dup.append(f"{m}（{seen[m]} 与 {layer}）")
                seen[m] = layer
        assert not dup, f"这些模块被分进了两层：{dup}"

    def test_util层实测确实是叶子(self):
        """util 的全部意义就是「不依赖 services 内任何模块」。
        这条一旦不成立，它就不再能被所有人安全 import，也就没资格叫叶子。"""
        spec = _M.get("services_layer", {})
        util = set(spec.get("util", {}).get("modules", []))
        assert len(util) > 50, f"util 只有 {len(util)} 个，分层没生成对"
        bad = sorted(
            f"{e.src} -> {e.dst}"
            for e in _G.edges
            if e.src in util and e.dst.startswith("services.") and e.dst != e.src
        )
        assert not bad, f"util 层有模块依赖了 services 内其它模块：{bad[:6]}"

    def test_没有新增的越层依赖(self):
        now = set(arch_graph.services_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("services_violations", []))
        new = sorted(now - base)
        assert not new, (
            f"services 内部新增了越层依赖：{new}\n"
            f"叶子不许碰上层、core 不许碰 flow。要么调整代码，要么"
            f"在 architecture.toml 里把模块挪到合适的层（并说明为什么）。"
        )

    def test_越层基线只许变短(self):
        now = set(arch_graph.services_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("services_violations", []))
        stale = sorted(base - now)
        assert not stale, f"这些越层已经修好了，从 baseline 里删掉：{stale}"

    def test_分层规则本身不许反向(self):
        """⚠ 反向判据：rank 高的可以依赖 rank 低的，反过来不行。
        规则写反了闸照样绿——它只会忠实地执行一条错规则。"""
        spec = _M.get("services_layer", {})
        rank = {k: v.get("rank", 99) for k, v in spec.items()}
        for name, cfg in spec.items():
            for dep in cfg.get("may_depend_on", []):
                assert dep in spec, f"{name} 依赖了不存在的层 {dep}"
                assert rank[dep] < rank[name], (
                    f"{name}(rank={rank[name]}) 声明可以依赖 {dep}(rank={rank[dep]})"
                    f"——方向反了，这条规则会把越层放行"
                )


class Test同一个crate内部允许互指:
    """⚠ 这个概念不是给环开的后门，是把 grok 的模型补全。

    Rust 禁止的是 **crate 之间**成环；**同一个 crate 内部的模块可以互相引用**。
    实测 grok-build：`xai-grok-tools` 内有 8 组互相引用的模块对、
    `xai-grok-shell` 内 15 组，其中 `implementations ⇄ registry` 与我们
    `capability_maps ⇄ slide_rule_executor` 形状完全一样（注册表与实现互指）。

    我们的模块粒度比 crate 细，所以要显式声明谁跟谁是一个 crate。
    **闸没有变松**：跨 component 的环照样红，下面第一条钉的就是这个。
    """

    def test_跨component的环照样红(self):
        """⚠ 最要紧的一条。这个概念要是把跨组的环也放行了，闸就废了。"""
        cyc = "services.a -> services.b -> services.a"
        import unittest.mock as mock

        with mock.patch.object(arch_graph, "find_cycles", lambda _g: [cyc]):
            split = {
                "component": {
                    "x": {"modules": ["services.a"]},
                    "y": {"modules": ["services.b"]},
                }
            }
            assert arch_graph.cross_component_cycles(_G, split) == [cyc], (
                "跨 component 的环被放行了——闸废了"
            )
            # ⚠ 同组**也不够**：还得那个组明写 allow_internal_cycles。
            #   2026-08-29 把 270 个模块全归组之后，「同组即放行」会让环判据
            #   当场废掉一大半——归组是为了声明依赖，不是给环发通行证。
            same = {"component": {"x": {"modules": ["services.a", "services.b"]}}}
            assert arch_graph.cross_component_cycles(_G, same) == [cyc], (
                "同组但没 opt-in 就被放行了——归组成了消环的后门"
            )
            opted = {
                "component": {
                    "x": {
                        "modules": ["services.a", "services.b"],
                        "allow_internal_cycles": True,
                    }
                }
            }
            assert arch_graph.cross_component_cycles(_G, opted) == [], (
                "明写了 allow_internal_cycles 还不放行——那 grok 的模型就没抄对"
            )

    def test_没声明component的模块_成环照样红(self):
        """⚠ 反向判据：默认是严的。不写声明 = 不许成环。"""
        import unittest.mock as mock

        with mock.patch.object(
            arch_graph, "find_cycles", lambda _g: ["services.p -> services.q -> services.p"]
        ):
            assert arch_graph.cross_component_cycles(_G, {}) != []

    def test_每个component都写了理由(self):
        """⚠ 门槛：得能说清「它们为什么是一个东西」，而不是「它们碰巧成环」。

        ⚠ 2026-08-29 把字数门槛从 30 降到 15，并补了「理由不许重复」。
          原因：全仓归组之后有 8 个组的理由**本身是有信息的**，只是中文密度高、
          不到 30 字（「最底下的叶子：配置与数据形状。谁都能依赖它，它谁都不依赖。」）。
          **为了凑字数去加水，判据就变成了装饰**——本仓第五条：判据要盯语义。
          真正能挡住敷衍的是**去重**：抄一份模板套 23 个组，当场红。
        """
        comps = _M.get("component", {})
        assert comps, "没有 component 声明——如果是有意的，把这条判据一起删掉"
        whys = {}
        for name, spec in comps.items():
            why = (spec.get("why") or "").strip()
            assert len(why) >= 15, f"component {name} 没写清为什么它们是一个东西"
            assert why not in whys, (
                f"component {name} 与 {whys[why]} 的理由一模一样——"
                f"套模板等于没写"
            )
            whys[why] = name
            assert spec.get("modules"), f"component {name} 是空的"

    def test_opt_in允许内部成环的组必须很小(self):
        """⚠ 这条替代了旧的「component 不许无限膨胀」。

        旧判据挡的是「把半个仓塞进一个 component 来消环」。2026-08-29 全仓归组
        之后那条按字面必然红（270 个模块都在组里），但**它挡的那件事仍然要挡**——
        只是位置变了：现在能消环的只有 `allow_internal_cycles` 那几个组，
        所以门槛钉在**它们**身上。
        """
        comps = _M.get("component", {})
        opted = {n: c for n, c in comps.items() if c.get("allow_internal_cycles")}
        assert len(opted) <= 2, f"太多组允许内部成环了：{sorted(opted)}"
        for name, c in opted.items():
            mods = c.get("modules", [])
            assert len(mods) <= 6, (
                f"{name} 允许内部成环却有 {len(mods)} 个模块——"
                f"组越大，这条豁免盖住的东西越多，等于拿声明消环"
            )

    def test_单个组不许吃掉半个仓(self):
        """⚠ 组太大就退化成「没分组」：依赖声明会变成一句废话。"""
        comps = _M.get("component", {})
        total = len(_G.modules)
        for name, c in comps.items():
            n = len(c.get("modules", []))
            assert n <= total // 4, (
                f"{name} 有 {n} 个模块（全仓 {total}）——太大了，"
                f"组间依赖声明会退化成废话"
            )


class Test卫星组不许存在:
    """⚠ 2026-08-29：这条判据是我自己栽了一跤之后加的。

    `refine` 三个模块唯一的 import 方是 `spec_first_pipeline`，而它们又回读
    spec-first 自己的校验器——`refine ⇄ spec_first` 这个组间环的全部内容。
    我在 §22.3 拒绝过合并，理由是「refine_page_scope 有 8 个消费者散在三个组」。
    **那个 8 是裸 grep 数出来的**，命中的是注释和文档字符串；依赖图里只有 1 个。

    用 grep 数依赖，错的方向刚好是「看起来更耦合」——于是它替我把该做的事挡下来了，
    而且看着像审慎。这条判据把「数消费者」从人手里拿走。
    """

    def test_没有卫星组(self):
        sat = arch_graph.satellite_components(_G, _M)
        assert not sat, (
            f"{sat}\n那不是两个 crate，是一个（grok 允许同 crate 内模块互指）。"
            f"合并掉，或者在 why 里说清为什么它该独立。"
        )

    def test_判据自己不是空转(self):
        """⚠ 上面那条恒绿的话，跟没有是一样的。这里造一份必然命中的 manifest，
        证明探测器真的会报。"""
        import copy

        man = copy.deepcopy(_M)
        man["component"] = {
            "zz_host": {"why": "样本", "may_depend_on": [], "modules": ["zzh.a"]},
            "zz_sat": {"why": "样本", "may_depend_on": ["zz_host"], "modules": ["zzs.a"]},
        }
        g2 = copy.copy(_G)
        g2.edges = [
            arch_graph.Edge(src="zzh.a", dst="zzs.a", src_pkg="zzh", dst_pkg="zzs",
                            deferred=False, line=1),
            arch_graph.Edge(src="zzs.a", dst="zzh.a", src_pkg="zzs", dst_pkg="zzh",
                            deferred=False, line=1),
        ]
        assert arch_graph.satellite_components(g2, man), "探测器报不出必然命中的样本"


class Test一件事不许拆在两个组:
    """⚠ 2026-08-29 抓到的自打脸归组，也是 `drive ⇄ model_core` 里 14 条边的来源。

    `run_cancel`（协作式取消）一直在 platform，而它的三个亲兄弟
    `run_pause`（协作式暂停）/ `run_degradation`（本轮降级标记）/
    `repeat_policy`（同一步连着跑几次）在 drive。同一件事——「本轮该不该继续、
    怎么继续」——被拆在两个组，于是引擎为了读一个降级标记就得反过来依赖驱动组。

    **归组是判据的输入。** 这一条把那个输入本身钉住。
    """

    def test_运行控制面四个模块在同一个组(self):
        want = {
            "services.run_cancel",
            "services.run_pause",
            "services.run_degradation",
            "services.repeat_policy",
        }
        got = {m: _COMP.get(m) for m in sorted(want)}
        assert len(set(got.values())) == 1, (
            f"「本轮该不该继续」这件事又被拆开了：{got}。"
            f"拆开的代价是引擎为了读一个标记去依赖驱动组（2026-08-29 实测 14 条边）"
        )

    def test_运行控制面是叶子(self):
        """⚠ 它能被引擎/驱动/spec-first/路由同时依赖的全部理由。
        一旦它开始依赖上层，`model_core ⇄ drive` 会原样长回来。"""
        comp = _COMP.get("services.run_cancel")
        spec = (_M.get("component") or {}).get(comp) or {}
        assert set(spec.get("may_depend_on") or []) <= {"platform"}, (
            f"{comp} 开始依赖 platform 以外的组了——它就不再是谁都能安全依赖的叶子"
        )
        members = set(spec.get("modules") or [])
        bad = sorted(
            f"{e.src} -> {e.dst}"
            for e in _G.edges
            if e.src in members and _COMP.get(e.dst) not in (comp, "platform", None)
        )
        assert not bad, f"运行控制面反过来依赖上层了：{bad}"


class Test没人import的模块只许变少:
    """抄 grok 的 workspace 成员关系：他们 90 个 crate 里被依赖数为 0 的只有装配根
    （因为它是 binary）。入口天然没上游，其余模块没上游就得解释。

    ⚠ **这不是待删清单。** 实测 54 个里绝大多数是三类各有理由的东西：
    Node 边界镜像、脚本/评测插座、未挂载的基线面。所以判据是棘轮，不是"清零"。
    """

    def test_没有新增的孤儿(self):
        now = set(arch_graph.orphans(_G, _M))
        base = set(_M.get("baseline", {}).get("orphans", []))
        new = sorted(now - base)
        assert not new, (
            f"这些模块没有任何人 import：{new}。\n"
            f"要么把它接上，要么在 architecture.toml 的 [entrypoints] 里说清为什么。"
            f"不许直接塞进 baseline。"
        )

    def test_基线只许变短(self):
        """⚠ 反向判据：接上了/删掉了就要从基线里划掉，
        否则下一个人以为那笔欠账还在。"""
        now = set(arch_graph.orphans(_G, _M))
        base = set(_M.get("baseline", {}).get("orphans", []))
        stale = sorted(base - now)
        assert not stale, f"这些已经不是孤儿了，从 baseline.orphans 里删掉：{stale}"

    def test_入口声明不许当消孤儿的开关(self):
        """⚠ 这一组唯一的后门：往 [entrypoints] 里写 `services.*` 就能
        一口气把整个包的孤儿全抹掉，而且看起来完全合法。"""
        import fnmatch

        pats = list((_M.get("entrypoints") or {}).get("patterns") or [])
        assert pats, "[entrypoints] 是空的，判据会空过"
        roots = {m.split(".")[0] for m in _G.modules}
        for p in pats:
            covered = [m for m in _G.modules if fnmatch.fnmatch(m, p)]
            # 罩住一整个包 = 那个包的孤儿全免检，等于把闸关掉
            assert p not in {f"{r}.*" for r in roots if r != "scripts"}, (
                f"入口模式 {p} 罩住了整个包——这是消孤儿的开关，不是入口声明"
            )
            assert covered, f"入口模式 {p} 一个模块都没罩到，是不是写错了/已经删了"

    def test_入口罩住的必须真的没人import(self):
        """⚠ 反向判据。被声明成入口、却其实有上游的模块，说明这条声明是错的
        （或者代码变了）——留着它就是一条永远不会被检验的免检条。

        `scripts.*` 例外：脚本之间互相 import 是常事，它们仍然个个是入口。
        """
        import collections
        import fnmatch

        indeg = collections.Counter()
        for e in _G.edges:
            indeg[e.dst] += 1
        pats = [p for p in ((_M.get("entrypoints") or {}).get("patterns") or [])
                if not p.startswith("scripts.")]
        wrong = sorted(
            m for m in _G.modules
            if indeg[m] and any(fnmatch.fnmatch(m, p) for p in pats)
        )
        # app 被 scripts import 是正常的（脚本借装配根起服务），单独放行
        wrong = [m for m in wrong if m != "app"]
        assert not wrong, f"这些声明成入口的模块其实有人 import：{wrong}"


class Test显式例外不是后门:
    """⚠ `[accepted]` 与 `[baseline]` 是两件事：baseline 是欠账（只许变少），
    accepted 是「就该这样，原因如下」。grok 的对应物是 Cargo.toml 依赖行上那句
    注释——依赖存在是事实，**为什么存在**得写下来。

    这一组判据挡的是它退化成「消违规的开关」。
    """

    def test_每条例外都写了理由(self):
        """⚠ 2026-08-29 起仓里例外是 0 条，这条目前**空转**（逐条判据，没条目就没得判）。
        不是漏筛：机制本身由下面 `test_一个例外不许放行同一对包上的其它边` 自造样本咬住。
        哪天再加例外，这条自动重新生效。"""
        for edge, why in arch_graph.accepted_edges(_M).items():
            assert len(why) >= 30, f"例外 {edge} 没写清为什么——不写理由就不算显式"

    def test_例外必须真的存在于代码里(self):
        """⚠ 反向判据：删掉那条依赖之后，例外要跟着删。
        留着过期例外 = 下一个人以为那条依赖还在，也 = 悄悄放行同名的新边。"""
        real = {f"{e.src} -> {e.dst}" for e in _G.edges}
        stale = sorted(set(arch_graph.accepted_edges(_M)) - real)
        assert not stale, f"这些例外对应的依赖已经没了，从 architecture.toml 删掉：{stale}"

    def test_例外数量不许膨胀(self):
        n = len(arch_graph.accepted_edges(_M))
        assert n <= 5, (
            f"显式例外有 {n} 条——超过个位数就不再是「例外」，"
            f"该回头看是不是分层本身画错了"
        )

    def test_一个例外不许放行同一对包上的其它边(self):
        """⚠ 违规是按**包对**报的，例外是按**具体边**给的。

        只要包对背后还有一条没被接受的边，这个包对就得照样红——
        否则一条例外会顺手把同一对包上所有边一起放行，闸当场穿底。
        """
        # ⚠ 2026-08-29：这条原本拿仓里真实的例外来构造样本，最后一条例外还清
        #   之后它变成 `assert ok` 直接红——**判据在为自己的存在而红**，
        #   而不是在报问题。改成自己造一份 manifest：现在 0 条例外也照样有效，
        #   而且不管仓里将来有没有例外，测的都是同一件事（机制本身）。
        import copy

        man = copy.deepcopy(_M)
        man["layer"] = {
            "zzsrc": {"may_depend_on": [], "why": "判据自造的样本包"},
            "zzdst": {"may_depend_on": [], "why": "判据自造的样本包"},
        }
        man["accepted"] = [
            {"edge": "zzsrc.a -> zzdst.a", "why": "样本：这一条是被显式接受的"}
        ]
        assert set(arch_graph.accepted_edges(man)) == {"zzsrc.a -> zzdst.a"}

        def _edge(src, dst):
            return arch_graph.Edge(
                src=f"zzsrc.{src}", dst=f"zzdst.{dst}",
                src_pkg="zzsrc", dst_pkg="zzdst", deferred=False, line=1,
            )

        g2 = copy.copy(_G)

        # 只有那条被接受的边 → 这个包对不该报
        g2.edges = [_edge("a", "a")]
        assert "zzsrc -> zzdst" not in arch_graph.layer_violations(g2, man), (
            "唯一一条边已被显式接受，却还在报违规——例外根本没生效"
        )

        # 同一对包上多一条没被接受的边 → 必须照样报
        g2.edges = [_edge("a", "a"), _edge("b", "b")]
        assert "zzsrc -> zzdst" in arch_graph.layer_violations(g2, man), (
            "同一对包上多出一条没被接受的边，却没报违规——例外放行得太宽"
        )


class Test孤儿都要有归类:
    """⚠ 一张没有归类的名单，下一个人只能重新读一遍——而前两次重读
    （§26 与 §30）得出了不同的、且都不完整的结论。

    2026-08-29 夜第三次读，翻出了前两次都没有的第三种可能：
    **接线在，只是在另一门语言里**（Node 在子进程里按拼出来的字符串 __import__）。
    零入度不等于没人用。归类就是为了让这个结论留得住。
    """

    def test_每个孤儿都归了类(self):
        missing, _, _ = arch_graph.orphan_reason_gaps(_G, _M)
        assert not missing, (
            f"这些没人 import 的模块没有归类：{missing}\n"
            f"读它的模块头，在 architecture.toml 的 [orphan_reasons] 里归一类。"
            f"⚠ 别猜——§26 和 §30 各猜过一次，两次都不完整。"
        )

    def test_归类不许指向已经不是孤儿的模块(self):
        """⚠ 反向判据。它被接上了是好事，但记录留着就变成一份过期的历史，
        下一个人会以为那笔账还在（同 baseline 只许变短）。"""
        _, stale, _ = arch_graph.orphan_reason_gaps(_G, _M)
        assert not stale, (
            f"这些已经不是孤儿了（有人 import 了），从 [orphan_reasons] 里删掉：{stale}"
        )

    def test_类别名必须在词表里(self):
        """⚠ 拼错的类别名不会报错，只会静静地把这条记录变成不算数的——
        同 §14.6 那 28 份手抄环境开关里对不上的那两份。"""
        _, _, unknown = arch_graph.orphan_reason_gaps(_G, _M)
        assert not unknown, (
            f"这些归类名不在词表 {sorted(arch_graph.ORPHAN_CATEGORIES)} 里：{unknown}"
        )

    def test_跨语言入口那批必须同时被跨语言判据钉住(self):
        """⚠ 这条是上面三条的**意义**所在。

        `cross_language_entry` 是唯一一类「零入度但绝不许删」的模块。
        光在清单里标一行不够——标签挡不住 `git rm`。真正挡住它的是
        `tests/test_cross_language_entrypoints.py` 里那份 ADAPTERS 名单。
        两边对不上，就等于这一类只有说法没有闸。
        """
        import re

        tagged = {
            m for m, c in (_M.get("orphan_reasons") or {}).items()
            if c == "cross_language_entry"
        }
        src = (
            pathlib.Path(__file__).resolve().parent / "test_cross_language_entrypoints.py"
        ).read_text(encoding="utf-8")
        adapters = re.search(r"^ADAPTERS = \(([^)]*)\)", src, re.M)
        assert adapters, "test_cross_language_entrypoints.py 里找不到 ADAPTERS 名单"
        pinned = {
            f"services.web_aigc_{a}_adapter"
            for a in re.findall(r'"([^"]+)"', adapters.group(1))
        }
        assert tagged == pinned, (
            f"清单里标成 cross_language_entry 的：{sorted(tagged)}\n"
            f"跨语言判据实际钉住的：        {sorted(pinned)}\n"
            f"对不上就意味着有模块顶着「产线代码不许删」的标签，却没有任何判据护着它。"
        )


class Test手画降为历史:
    """权威只留自动生成的图。V5.x～V6.0 手画必须标明非权威，禁止再打 ⚑。"""

    _HISTORIC = (
        "docs/SlideRule V5.2 架构图.md",
        "docs/SlideRule V5.3 架构图.md",
        "docs/SlideRule V5.4 架构图.md",
        "docs/SlideRule V5.5 架构图.md",
        "docs/SlideRule V5.6 架构图.md",
        "docs/SlideRule V5.7 架构图.md",
        "docs/SlideRule V5.8 架构图.md",
        "docs/SlideRule V5.9 架构图.md",
        "docs/SlideRule V6.0 架构图.md",
        "docs/系统 Mermaid 架构图.md",
    )

    def test_手画都标明非权威(self):
        mark = arch_graph.HISTORIC_MARK
        missing = []
        for rel in self._HISTORIC:
            p = arch_graph.REPO / rel
            assert p.is_file(), f"找不到历史图 {rel}"
            head = p.read_text(encoding="utf-8")[:1200]
            if mark not in head:
                missing.append(rel)
        assert not missing, (
            f"这些手画架构图没标明「{mark}」：{missing}\n"
            f"权威图只留自动生成的，手画是实验室笔记。"
        )

    def test_V6_0头注禁止再打旗(self):
        head = (arch_graph.REPO / "docs/SlideRule V6.0 架构图.md").read_text(
            encoding="utf-8"
        )[:800]
        assert "禁止再打新" in head, "V6.0 必须自己写着不许再打 ⚑"

    def test_权威图是生成的那几份(self):
        """反向：生成的图必须自称生成的，否则手画和权威分不清。"""
        for p in (arch_graph.DIAGRAM, arch_graph.REPO_DIAGRAM):
            assert p.is_file(), f"{p} 不在——跑 arch_graph.py --emit"
            head = p.read_text(encoding="utf-8")[:500]
            assert "不要手改" in head or "别手改" in head, f"{p} 没自称是生成的"


class Testservices三层进mermaid:
    """表里有分层但图上没有 = 抄 grok 叶子 crate 是空话。"""

    def test_util_core_flow是mermaid节点(self):
        doc = arch_graph.render_doc(_G, _M)
        assert "### services 三层（从 import 算出，不是表）" in doc
        for layer in ("util", "core", "flow"):
            assert f'  {layer}["' in doc, f"{layer} 只在表里，没进 mermaid"

    def test_层间边来自真import(self):
        """flow 依赖 core 必须画出来。没有这条边 = 图在撒谎。"""
        mermaid = arch_graph.emit_services_layer_mermaid(_G, _M)
        assert "flow -->" in mermaid or "flow -.->" in mermaid
        assert "|core|" in mermaid.replace(" ", "") or " core" in mermaid

    def test_反向_删掉层图这段标题就红(self):
        src = (arch_graph.ROOT / "arch_graph.py").read_text(encoding="utf-8")
        assert "emit_services_layer_mermaid" in src
        assert "从 import 算出，不是表" in src


class Test编排环从活路径生成:
    """run_control（实际是 rehearsal_control）→ handoff → spec_first。
    ⚠ 不要跟 component.run_control（pause/cancel 叶子）搞混。"""

    def test_handoff函数体真的调用工厂(self):
        assert arch_graph.handoff_is_live(_M), (
            "spine.handoff 对不上活路径：_handoff_factory 里没有 "
            "start_drive_full_factory_run。改代码或改 architecture.toml。"
        )

    def test_图上标了handoff(self):
        mermaid = arch_graph.emit_spine_mermaid(_G, _M)
        assert "handoff" in mermaid, "编排环图没标 handoff——那条链看起来像普通 import"
        assert "services.rehearsal_control" in mermaid
        assert "services.spec_first_pipeline" in mermaid
        assert any(
            "v5_full_driver" in line
            and "v5_capability_executor" in line
            and "-->" in line
            for line in mermaid.splitlines()
        ), "主循环到执行器的边没画上，编排环在图上是断的"

    def test_handoff探测器删了调用就红(self, tmp_path):
        """变异：函数在、调用不在，必须报假。"""
        p = tmp_path / "fake.py"
        p.write_text("async def _handoff_factory():\n    return 1\n", encoding="utf-8")
        assert not arch_graph.handoff_is_live_from(
            p, "_handoff_factory", "start_drive_full_factory_run"
        )
        p.write_text(
            "async def _handoff_factory():\n"
            "    await start_drive_full_factory_run()\n",
            encoding="utf-8",
        )
        assert arch_graph.handoff_is_live_from(
            p, "_handoff_factory", "start_drive_full_factory_run"
        )

    def test_能力执行器活路径调run_spec_first(self):
        """第二条链：v5_capability_executor 里必须还有 run_spec_first(。"""
        src = (
            arch_graph.ROOT / "services" / "v5_capability_executor.py"
        ).read_text(encoding="utf-8")
        assert "run_spec_first(" in src, (
            "v5_capability_executor 不再调用 run_spec_first——"
            "编排环图画到 spec_first 就成了不通电的插座"
        )


class Test跨语言边入全仓图:
    """Nx implicitDependencies：静态看不见的边必须显式声明并画出来。"""

    def test_声明与Node接线对得上(self):
        missing, stale = arch_graph.cross_language_gaps(_M)
        assert not missing, f"Node 接了但 toml 没声明：{missing}"
        assert not stale, f"toml 声明了但 Node 不接了：{stale}"

    def test_四个adapter都在全仓mermaid里(self):
        ts_pkgs, ts_edges = {"server": 1, "client": 1}, {("client", "server"): 0}
        mermaid = arch_graph.emit_repo_mermaid(_G, _M, ts_pkgs, ts_edges)
        for adapter in ("open", "orchestration", "web_qa", "device_location"):
            assert adapter in mermaid, f"全仓图没画 adapter {adapter}"
            assert f"services.web_aigc_{adapter}_adapter" in mermaid

    def test_反向_声明了却不画就红(self):
        src = (arch_graph.ROOT / "arch_graph.py").read_text(encoding="utf-8")
        assert "cross_language_edge" in src
        assert "emit_repo_mermaid" in src

    def test_全仓图与代码同步(self):
        assert arch_graph.REPO_DIAGRAM.exists(), (
            "全仓图不在——跑 arch_graph.py --emit"
        )
        ts_pkgs, ts_edges = arch_graph.ts_package_graph()
        want = arch_graph.render_repo_doc(_G, _M, ts_pkgs, ts_edges)
        got = arch_graph.REPO_DIAGRAM.read_text(encoding="utf-8")
        assert got == want, "全仓图和代码对不上了。跑 arch_graph.py --emit"


def _services_outdegree(module: str) -> list:
    return sorted(
        {
            e.dst
            for e in _G.edges
            if e.src == module and e.dst.startswith("services.") and e.dst != module
        }
    )


class Test叶子crate对齐grok:
    def test_workflow_registry_不依赖其它services(self):
        assert "services.workflow_registry" in _G.modules
        bad = _services_outdegree("services.workflow_registry")
        assert not bad, f"workflow_registry 不是叶子：{bad}"

    def test_closed_tools_不依赖其它services(self):
        assert "services.closed_tools" in _G.modules
        bad = _services_outdegree("services.closed_tools")
        assert not bad, f"closed_tools 不是叶子：{bad}"
        src = (arch_graph.ROOT / "services" / "rehearsal_control.py").read_text(
            encoding="utf-8"
        )
        assert "from services.closed_tools import" in src

    def test_session_events_不依赖其它services(self):
        assert "services.session_events" in _G.modules
        bad = _services_outdegree("services.session_events")
        assert not bad, f"session_events 不是叶子：{bad}"

    def test_控制面和工厂是两个component(self):
        assert _COMP.get("services.rehearsal_control") == "control"
        assert _COMP.get("services.drive_full_factory") == "drive"
        assert _COMP.get("services.rehearsal_control") != _COMP.get(
            "services.drive_full_factory"
        )

    def test_component图handoff不是普通调用(self):
        doc = arch_graph.render_doc(_G, _M)
        assert "control -->|handoff" in doc.replace(" ", "") or "|handoff" in doc
        assert "services.rehearsal_control" in {
            e.src for e in _G.edges if e.dst == "services.drive_full_factory"
        }


class Test新边不许藏进函数体:
    def test_deferred只许变少(self):
        now = arch_graph.deferred_count(_G)
        base = _M.get("baseline", {}).get("deferred")
        assert base is not None, "architecture.toml [baseline] 要有 deferred 条数"
        assert now <= int(base), (
            f"函数体 import 新增了 {now - int(base)} 条（现 {now}，基线 {base}）。新边顶层 import。"
        )
        assert now >= int(base), (
            f"函数体 import 已经变少（现 {now}），把 baseline.deferred 改成 {now}"
        )

    def test_反向_探测器真的会报(self):
        assert arch_graph.deferred_count(_G) > 100, "一条 deferred 都没有，棘轮会空过"


class Test两个大块加一批叶子:
    def test_util叶子多于flow编排(self):
        spec = _M.get("services_layer", {})
        util = len(spec.get("util", {}).get("modules", []))
        flow = len(spec.get("flow", {}).get("modules", []))
        assert set(spec) == {"util", "core", "flow"}, (
            f"services 分层应保持 util/core/flow 三层，不要再切成 {sorted(spec)}"
        )
        assert util > flow * 2, (
            f"util={util} flow={flow}：叶子应明显多于编排大块，"
            "别把 services 切成 90 个平均文件"
        )
        # ⚠ 2026-09-15：这条原来写死 `flow <= 40`，而引入它的那笔提交
        #   （c222b5a6）**当时 flow 就已经是 43**——也就是说它从出生起
        #   一次都没绿过，不是哪次改动碰红的。查两遍确认：在 9f55552 上
        #   单独重跑同样红，前后 flow 都是 43，一个没增一个没减。
        #
        #   40 从来没成立过，那不是棘轮是愿望。按仓里 [baseline] 的做法
        #   定在现值当棘轮：**只许变短**。现在它起码能拦住第 44 个；
        #   哪天真把编排拆回 40 以下，把这个数一起改小，别留着。
        assert flow <= 43, f"flow 已经 {flow} 个，只许变短——别往上加编排大块"

    def test_产品图不画grok巨石(self):
        doc = arch_graph.render_doc(_G, _M)
        assert "不搬" in doc
        mermaid = []
        parts = doc.split("```mermaid")
        for p in parts[1:]:
            mermaid.append(p.split("```", 1)[0])
        blob = "\n".join(mermaid)
        for name in arch_graph.FORBIDDEN_GROK_COPY:
            assert name in doc, f"产品图要写明不搬 {name}"
            assert name not in blob, f"产品 mermaid 里出现了不该抄的 {name}"


class Test闸清单:
    """依赖图回答「谁 import 谁」，回答不了「这个系统有哪些判定、谁看着它们」。

    2026-09-05 补的这一节回答后者。起因是「为什么几个月没审查出来」——
    答案里有一条是**没人知道这里到底有几道闸**：15 个会话全被同一道闸按
    同一个理由拦下，而没有观察它的位置。
    """

    def test_清单是算出来的_不是手写的(self):
        from arch_graph import all_blocker_codes, gate_inventory

        inv = gate_inventory()
        assert inv, "一条闸都没扫出来——扫描器坏了，不是仓里真没有闸"
        codes = all_blocker_codes()
        # 闭环那三条必须在（它们是真机上天天在跑的）
        for c in ("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
                  "CLOSURE_GOAL_RELEVANCE_FAILED",
                  "CLOSURE_FACTORY_TODO_OPEN"):
            assert c in codes, f"{c} 没被扫出来"

    def test_每条拦截理由都声明了归属(self):
        """★ 新增一条 code 必须回答「它坏成一直响的时候谁会发现」。"""
        from arch_graph import load_manifest, undeclared_gate_codes

        und = undeclared_gate_codes(load_manifest())
        assert not und, (
            f"这些拦截理由没在 [gate_codes] 里声明：{und}。"
            f"写上它归哪道体检的闸，确实不该体检就写空串并说明理由。"
        )

    def test_不体检的欠账只许变少(self):
        from arch_graph import gate_codes_without_health, load_manifest

        m = load_manifest()
        now = gate_codes_without_health(m)
        base = (m.get("baseline") or {}).get("gate_codes_without_health")
        assert base is not None, "基线没了——欠账账本被人删了"
        assert len(now) <= int(base), f"不体检的拦截理由变多了：{now}"

    def test_闭环那三道闸真的进了体检(self):
        """★ 反向配对：声明归声明，代码里得真调。

        钉住的是「声明」和「实现」不许分家——toml 里写着 evidence 归体检，
        而 v5_capability_executor 里没这一行，那份声明就是纸面上的。
        """
        from arch_graph import gate_inventory, load_manifest

        declared = {
            g for g in (load_manifest().get("gate_codes") or {}).values()
            if str(g or "").strip()
        }
        recorded = {g for row in gate_inventory() for g in row["gates"]}
        missing = declared - recorded
        assert not missing, f"toml 里声明了这些闸进体检，代码里却没人调：{sorted(missing)}"

    def test_图里那一节跟着代码走(self):
        """生成的架构图里必须有闸清单这一节，且条数对得上。"""
        import pathlib

        from arch_graph import DIAGRAM, all_blocker_codes

        doc = pathlib.Path(DIAGRAM).read_text(encoding="utf-8")
        assert "## 闸清单" in doc, "架构图里没有闸清单——重新 --emit"
        for code in all_blocker_codes():
            assert f"`{code}`" in doc, f"{code} 没进架构图，图与代码不同步"

    def test_清单要盖住routes_不只是services(self):
        """★ 2026-09-05：第一版只扫 `services.`，`routes/` 整片没算。

        于是 `pageEdit`（点选编辑 / 画布存回页面前的体检）**根本不在清单上**——
        而它恰恰是当天抓到「交付页的 Tailwind 被摘掉」的那一道。
        一份只盖住一半仓的清单，回答不了它自己声称回答的那个问题。
        """
        from arch_graph import gate_inventory

        mods = {row["module"] for row in gate_inventory()}
        assert any(m.startswith("routes.") for m in mods), (
            "闸清单没扫 routes/——接口层那几道闸整个看不见"
        )
        assert any(m.startswith("services.") for m in mods), "反向：services 那侧也得还在"

    def test_只报不拦的闸也要在图上(self):
        """★ §3 反向配对：上面那张表按 blocker code 排，**没有 code 的闸会整个漏掉**。

        只报不拦不等于不重要——§7 说增强类本来就该 fail-open。
        所以图里必须另有一张按闸名排的表，`gate_health` 记了谁就有谁。
        """
        import pathlib

        from arch_graph import DIAGRAM, gate_inventory, load_manifest

        doc = pathlib.Path(DIAGRAM).read_text(encoding="utf-8")
        table = load_manifest().get("gate_codes") or {}
        watched_codes = {str(v).strip() for v in table.values() if str(v or "").strip()}
        recorded = {g for row in gate_inventory() for g in row["gates"]}
        no_code = sorted(recorded - watched_codes)
        assert no_code, (
            "一道只报不拦的闸都没有了？那这条判据该跟着删，别留着自我印证"
        )
        for gate in recorded:
            assert f"`{gate}`" in doc, f"闸 {gate} 没进架构图，图与代码不同步"
