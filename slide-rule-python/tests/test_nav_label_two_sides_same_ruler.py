# -*- coding: utf-8 -*-
"""导航项检查跟渲染用同一把尺子（2026-09-05 真机第 4 轮抓到）。

## 事故

真机 sr-20260904214530（汉字连线消除小游戏）三页全报：

    [spec_first_pipeline] 外壳统一后仍不一致：p1.nav —
      导航项 ['挑战主', '限时对局', '战绩结算与历史']
      跟 spec 的页面清单 ['挑战主页', '限时对局页', '战绩结算与历史页'] 对不上

两个毛病叠在一起：

1. **两侧口径不一致（§4）**：导航项是 `nav_tab_label()` 渲染的——它会剥
   产品名前缀、剥「某某页」的「页」；而检查侧拿的是 **spec 原名**。
   于是**只要有一页的名字以「页」结尾，这条检查就必然报错**，跟壳对不对得上
   毫无关系。一条系统性误报的检查，下一个人只会学会忽略它——比没有更糟。
   （这跟今天那道「一直开火的闸」是同一种病，只是它一直在喊狼来了。）

2. **「主页」被当成后缀剥了**：「挑战主页」→「挑战主」。`首页` 早就在白名单里，
   `主页` 漏了；剥完 `len >= 2` 那道保险拦不住它（「挑战主」正好 3 个字）。
"""

import pytest

from services.page_naming import nav_tab_label


class Test主页不是后缀:
    @pytest.mark.parametrize("name", ["挑战主页", "首页", "个人主页"])
    def test_主页首页原样保留(self, name):
        """连**手机**上都不许剥——「页」是词的一部分，不是后缀。"""
        assert nav_tab_label(name, strip_page_suffix=True) == name

    @pytest.mark.parametrize("name,want", [
        ("限时对局页", "限时对局"),
        ("战绩结算与历史页", "战绩结算与历史"),
        ("古籍列表页", "古籍列表"),
    ])
    def test_手机上真后缀照剥(self, name, want):
        """★ 反向配对：别为了修一个词把整条规则关掉。

        手机上剥「页」是对的，有真机事故背书（2026-08-20 芸编智管：
        五项 × 390px，「页」单独折成第三行），也对得上 antd-mobile
        TabBar 官方 demo 的短名（首页/待办/消息/我的）。
        """
        assert nav_tab_label(name, strip_page_suffix=True) == want

    @pytest.mark.parametrize("name", ["工单详情页", "新建报修页", "分析页", "表单页"])
    def test_桌面不剥(self, name):
        """★ 标准答案：Ant Design Pro `src/locales/zh-CN/menu.ts` 里
        分析页/表单页/列表页/详情页/结果页/异常页…**14 项带「页」**。
        侧栏 w-64（256px）一行一项，放得下——那条剥「页」的补丁是为手机
        390px 底栏挤出来的，不该套到桌面上。
        """
        assert nav_tab_label(name) == name


class Test两侧同一把尺子:
    def test_检查侧用的就是渲染侧那个函数(self):
        """★ §1/§4：不切字符串，直接解析 `check_shell_consistency` 的 AST，
        看 `want = [...]` 那个表达式里到底调没调 `nav_tab_label`。

        ⚠ 第一版是按"锚点往前 1200 字"切片找的，变异（把 want 改回 spec 原名）
          之后判据照样绿——窗口里还有别的东西。切片锚点选错就是咬不住
          （本仓第二条）。
        """
        import ast
        import inspect

        from services import page_shell

        fn = None
        for node in ast.walk(ast.parse(inspect.getsource(page_shell))):
            if isinstance(node, ast.FunctionDef) and node.name == "check_shell_consistency":
                fn = node
        assert fn is not None, "check_shell_consistency 改名了——判据跟着失效"

        # ⚠ 这个函数里有**两个** `want = ...`（另一个算 aside 偏移），
        #   取最后一个会拿错。按"它读的是 spec.pages"来认人。
        want_expr = None
        for node in ast.walk(fn):
            if (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and getattr(node.targets[0], "id", None) == "want"
                    and "pages" in ast.dump(node.value)):
                want_expr = node.value
        assert want_expr is not None, "找不到那个按 spec.pages 算导航清单的 `want`"
        calls = {
            getattr(c.func, "id", getattr(c.func, "attr", None))
            for c in ast.walk(want_expr) if isinstance(c, ast.Call)
        }
        assert "nav_tab_label" in calls, (
            f"检查侧算 want 时没用渲染那把尺子（用到的是 {sorted(x for x in calls if x)}）"
            f"——只要有页名以「页」结尾就会系统性误报"
        )

    def test_一页名字带页时不再误报(self):
        """端到端：spec 里带「页」，渲染出来剥掉，两边仍应判一致。"""
        spec_names = ["挑战主页", "限时对局页", "战绩结算与历史页"]
        rendered = [nav_tab_label(n, strip_page_suffix=True) for n in spec_names]
        want = [nav_tab_label(n, strip_page_suffix=True) for n in spec_names]
        assert rendered == want, "同一把尺子量两遍还不一样，那是尺子有随机性"
        assert rendered == ["挑战主页", "限时对局", "战绩结算与历史"]


class Test替身别再被签名漂移打红:
    """★ 今晚第二次栽在同一件事上（第一次是 `fake_bind`，2026-09-05 早些时候）。

    `check_shell_consistency` 加了个 `device` 关键字参数，7 个判据文件里的
    替身写的是 `lambda p, s: []` ——**62 条判据当场炸在 TypeError 上**，
    一条真正的行为都没验到。产线是对的，红的全是替身。

    替身收 `*a, **kw` 就没这回事。这条判据钉住它，免得第三次。
    """

    def test_替身都收变长参数(self):
        import pathlib
        import re

        tests_dir = pathlib.Path(__file__).resolve().parent
        bad = []
        for f in tests_dir.glob("test_*.py"):
            for m in re.finditer(
                r'check_shell_consistency"?,\s*lambda\s+([^:]*):', f.read_text(encoding="utf-8")
            ):
                args = m.group(1).strip()
                if "*" not in args:
                    bad.append(f"{f.name}: lambda {args}")
        assert not bad, (
            f"这些 check_shell_consistency 的替身没收 *a/**kw，"
            f"产线签名一变就集体炸 TypeError：{bad}"
        )
