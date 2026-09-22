"""布尔环境开关：词表只许有一份，认不出来的值回落到**声明的默认**（2026-08-29）。

## 事故

对账时全仓手抄了 **28 份**同样的真假词表，散在 16 个文件里。
`refine_short_circuit.env_flag_off_values()` 的注释写着「跟仓里其它开关同一份
词表」——注释说了，没有任何东西保证，而且没有一个开关在用它。

手抄的直接后果不是"以后可能漂"，是**已经漂了两处，且两处都朝危险方向漂**：

    SLIDERULE_REFINE_MERGE_PATCH        默认开，却拿"开"的词表解析
      → 拼错一个字母 = 这根**应急闸把自己扳掉**（它的 docstring 正写着
        「线上出事要能一条环境变量退回」）

    SLIDERULE_PARALLEL_MODEL_GENERATION 默认关，却拿"关"的词表解析
      → 拼错一个字母 = 并行**静静打开**（它的 docstring 正用一整段解释
        并行为什么现在必须关着）

两处都不报错、不打日志。

抄的标准答案是 grok-build `xai-sqlite-journal`：
「A typo in the emergency kill-switch must be loud, not silently ignored.」
以及「Loud so field flips of the kill-switch are greppable in logs.」

## 判据形状

只测 `env_flags` 自己不够——那正是本仓第三条（函数写对了 ≠ 它被调用了）。
所以还有一条**反向判据**：全仓不许再出现手抄的词表。
"""

import os
import pathlib
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import env_flags  # noqa: E402

_ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _clean():
    env_flags.reset_shouted()
    yield
    env_flags.reset_shouted()
    os.environ.pop("X_AUDIT_FLAG", None)


class Test认不出来的值回落到声明的默认:
    """⚠ 回落到 default，**不是**回落到 False。回落到 False 就等于把
    SLIDERULE_REFINE_MERGE_PATCH 那个病做进公共实现里。"""

    @pytest.mark.parametrize("junk", ["ture", "onn", "enable", "yes please", "2", "-1"])
    def test_默认开的开关_拼错还是开(self, junk):
        os.environ["X_AUDIT_FLAG"] = junk
        assert env_flags.flag("X_AUDIT_FLAG", default=True) is True

    @pytest.mark.parametrize("junk", ["ture", "onn", "enable", "2"])
    def test_默认关的开关_拼错还是关(self, junk):
        os.environ["X_AUDIT_FLAG"] = junk
        assert env_flags.flag("X_AUDIT_FLAG", default=False) is False

    @pytest.mark.parametrize("good,expect", [
        ("1", True), ("true", True), ("YES", True), (" on ", True),
        ("0", False), ("false", False), ("NO", False), (" off ", False),
    ])
    def test_认得出来的值照常生效(self, good, expect):
        """⚠ 反向判据：别把"拼错回落默认"做成"什么都回落默认"——
        那样开关就彻底失灵了，而且同样不报错。"""
        os.environ["X_AUDIT_FLAG"] = good
        assert env_flags.flag("X_AUDIT_FLAG", default=not expect) is expect

    def test_没设就是默认(self):
        os.environ.pop("X_AUDIT_FLAG", None)
        assert env_flags.flag("X_AUDIT_FLAG", default=True) is True
        assert env_flags.flag("X_AUDIT_FLAG", default=False) is False

    def test_空串按没设处理(self):
        os.environ["X_AUDIT_FLAG"] = "   "
        assert env_flags.flag("X_AUDIT_FLAG", default=True) is True


class Test拼错必须吵:
    """⚠ 回落对了但一声不吭，运维仍然以为开关生效了——出事的时候有人在改环境
    变量，那正是最不该靠"猜它有没有生效"的时刻。"""

    def test_认不出来的值会喊一声(self, capsys):
        os.environ["X_AUDIT_FLAG"] = "ture"
        env_flags.flag("X_AUDIT_FLAG", default=True)
        out = capsys.readouterr().out
        assert "X_AUDIT_FLAG" in out and "ture" in out, out
        assert "认不出来" in out, out

    def test_同一个拼错只喊一次(self, capsys):
        """热路径上每轮都读开关，不去重会把日志刷爆。"""
        os.environ["X_AUDIT_FLAG"] = "ture"
        for _ in range(5):
            env_flags.flag("X_AUDIT_FLAG", default=True)
        assert capsys.readouterr().out.count("X_AUDIT_FLAG") == 1

    def test_覆盖真的生效时也留一行(self, capsys):
        """grok 原话：Loud so field flips of the kill-switch are greppable in logs."""
        os.environ["X_AUDIT_FLAG"] = "0"
        env_flags.flag("X_AUDIT_FLAG", default=True)
        assert "X_AUDIT_FLAG" in capsys.readouterr().out

    def test_没覆盖就别吵(self, capsys):
        """⚠ 反向判据：默认值走的那条路不许打日志，否则每轮都刷。"""
        os.environ.pop("X_AUDIT_FLAG", None)
        env_flags.flag("X_AUDIT_FLAG", default=True)
        assert capsys.readouterr().out == ""


class Test词表全仓只剩一份:
    """⚠ 反向判据，这条才是防漂的那一半：`env_flags` 写对了 ≠ 别人在用它。

    手抄一份新的照样能跑、照样绿——除非有人数着。
    """

    #: ⚠ 空白必须宽松：下面 _strip 走 tokenize，重组时 token 之间会插空格，
    #:   写死 `"1",` 这种紧挨着的形状会一条都匹配不到——判据当场打空。
    _INLINE = re.compile(
        r'[(\{]\s*"1"\s*,\s*"true"\s*,\s*"yes"\s*,\s*"on"\s*[)\}]'
        r'|[(\{]\s*"0"\s*,\s*"false"\s*,\s*"no"\s*,\s*"off"\s*[)\}]'
    )

    @staticmethod
    def _strip(src: str) -> str:
        """剥掉注释与字符串字面量再扫，用 tokenize（不是正则）。

        ⚠ 第一版直接扫原文，报了 5 处「手抄」——其中 4 处是**修复时写的说明里
          逐字引用了那个旧写法**（"原来是 in (…)"）。判据被自己要挡的那段文字
          骗了，正是本仓点名的那一口（判据 grep 到的词其实在注释里）。

        ⚠ 用 tokenize 而不是正则：词表本身就是一串带引号的字面量，用正则剥
          字符串会把要找的东西一起剥掉。tokenize 按语法分得清"这是注释/文档串"
          和"这是代码里的一个 frozenset 字面量"——后者的每个成员是独立的
          STRING token，拼回去还认得出来。
        """
        import io as _io
        import tokenize

        out = []
        try:
            for tok in tokenize.generate_tokens(_io.StringIO(src).readline):
                if tok.type == tokenize.COMMENT:
                    continue
                # 文档串也要剥。三引号是它跟"代码里的字面量"的分界：词表成员
                # 是 "1" / "off" 这种单引号 STRING token，留着才扫得到。
                if tok.type == tokenize.STRING and tok.string.lstrip("rbuf").startswith(
                    ('"""', "'''")
                ):
                    continue
                out.append(tok.string if tok.type != tokenize.NL else "\n")
        except (tokenize.TokenError, IndentationError, SyntaxError):
            return src  # 解析不了就按原文扫，宁可误报不许漏报
        return " ".join(out)

    def _sources(self):
        got = []
        for p in sorted(_ROOT.rglob("*.py")):
            rel = p.relative_to(_ROOT).as_posix()
            # ⚠ 2026-08-29：真身搬到 config/env_flags.py（原来住在 services 里，
            #   害得 sliderule_llm 要反向依赖业务层）。services/env_flags.py 现在
            #   只是转出层，两份都得豁免——只豁免旧路径的话，唯一那份正版词表
            #   会被自己的判据当成「手抄」。
            # ⚠ 2026-09-06 加 `tmp/`：那底下放的是**别人的仓库**
            #   （`tmp/oss-screenshot-to-code/backend/config.py` 是照抄口径时
            #   拉下来的参照实现，`.gitignore:133` 已经把整个 tmp/ 排掉）。
            #   拿"本仓不许手抄词表"去要求第三方代码，红的是噪音不是病 ——
            #   而一条长期红着的判据等于没有判据（本仓已经数过这个形状）。
            if rel.startswith((".venv/", "tests/", "tmp/")) or rel in (
                "config/env_flags.py",
                "services/env_flags.py",
            ):
                continue
            got.append((rel, p.read_text(encoding="utf-8", errors="ignore")))
        return got

    def _code_sources(self):
        """只留代码：注释与文档串里的引用不算手抄。"""
        return [(rel, self._strip(body)) for rel, body in self._sources()]

    def test_扫描真的量到了东西(self):
        """⚠ 先钉住非空：路径写歪 / 过滤写宽 / 剥注释剥过头，下面那条都会空过。"""
        srcs = self._code_sources()
        assert len(srcs) > 100, f"只扫到 {len(srcs)} 个源文件，判据会空过"
        assert any("SLIDERULE_" in body for _, body in srcs), "扫到的不是本仓源码"

    def test_剥注释之后仍然认得出手抄(self):
        """⚠ 判据的牙齿单独验一次：剥注释那一步很容易把要找的东西一起剥掉。

        （真发生过：第一版想用正则剥字符串，而词表本身就是一串字符串字面量。）
        """
        sample = (
            'def f():\n'
            '    """原来是 in ("1", "true", "yes", "on")"""\n'
            '    # 注释里也提一次 ("0", "false", "no", "off")\n'
            '    return raw in ("1", "true", "yes", "on")\n'
        )
        stripped = self._strip(sample)
        assert len(self._INLINE.findall(stripped)) == 1, (
            f"剥注释之后应当只剩代码里那一处，实得 {self._INLINE.findall(stripped)}"
        )

    def test_没有人再手抄词表(self):
        offenders = {
            rel: len(self._INLINE.findall(body))
            for rel, body in self._code_sources()
            if self._INLINE.search(body)
        }
        assert offenders == {}, (
            f"又有人手抄了真假词表：{offenders}。"
            f"用 services.env_flags 的 flag() / parse() / ON / OFF——"
            f"2026-08-29 手抄 28 份时，其中两份的默认与词表对不上，"
            f"拼错一个字母就静静地把开关扳到反面。"
        )


class Test两个真实开关的回落方向:
    """真身判据：上面测的是公共实现，这两条测**出过事的那两个开关自己**。"""

    def test_精修合并补丁_拼错仍然是开(self):
        from services import v5_llm_generate

        os.environ["SLIDERULE_REFINE_MERGE_PATCH"] = "ture"
        try:
            assert v5_llm_generate._refine_merge_patch_enabled() is True, (
                "应急闸被一个拼写错误静静扳掉了"
            )
        finally:
            os.environ.pop("SLIDERULE_REFINE_MERGE_PATCH", None)

    def test_并行生成_拼错仍然是关(self):
        from services import v5_parallel_generate

        os.environ["SLIDERULE_PARALLEL_MODEL_GENERATION"] = "onn"
        try:
            assert v5_parallel_generate.parallel_generation_enabled() is False, (
                "并行被一个拼写错误静静打开了"
            )
        finally:
            os.environ.pop("SLIDERULE_PARALLEL_MODEL_GENERATION", None)
