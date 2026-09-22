"""enrich_timing 的行为锁定。

这个模块的价值全在"绝不干扰被测链路"上，所以测试重点不是"打的数准不准"
（那是秒表的事），而是三条**破坏性**行为不能回归：

  ① 异常必须原样抛出 —— ENRICH 全程 fail-open，上游靠 except
     FreeformGenerationError 把失败的区块摘掉。计时器一旦吞异常，
     "生成失败"会变成"生成成功但内容为空"，比不埋点糟得多。
  ② 埋点自身出问题必须静默 —— 测量工具把被测流水线搞崩最没道理。
  ③ 输出必须是可解析的单行 key=value —— 它就是基线数据集本身，
     格式一坏，采集脚本静默拿到错数据。
"""

import io
import contextlib

import pytest

from services.enrich_timing import stage, timing_enabled


def _capture(fn):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn()
    return buf.getvalue()


def _parse(line: str) -> dict:
    """按约定的"空格切分 + = 切分"解析——采集脚本就是这么读的。"""
    assert line.startswith("[enrich-timing] "), line
    out = {}
    for tok in line[len("[enrich-timing] "):].strip().split():
        k, _, v = tok.partition("=")
        out[k] = v
    return out


def test_emits_single_parsable_line_on_success():
    out = _capture(lambda: _run_ok())
    lines = [l for l in out.strip().splitlines() if l]
    assert len(lines) == 1, f"一次 stage 只能打一行，实际 {len(lines)} 行"
    f = _parse(lines[0])
    assert f["stage"] == "unit.ok"
    assert f["ok"] == "1"
    assert f["page"] == "p1"
    assert f["got"] == "1"          # 块内追加的字段要能带出来
    assert f["ms"].isdigit()


def _run_ok():
    with stage("unit.ok", page="p1") as st:
        st["got"] = 1


def test_exception_propagates_and_is_recorded_as_failure():
    """① 最要紧的一条：异常不能被吞，同时要记成 ok=0。"""
    buf = io.StringIO()
    with pytest.raises(ValueError, match="boom"):
        with contextlib.redirect_stdout(buf):
            with stage("unit.fail", page="p2"):
                raise ValueError("boom")
    f = _parse(buf.getvalue().strip())
    assert f["ok"] == "0"
    assert f["stage"] == "unit.fail"


def test_keyboard_interrupt_also_propagates():
    """BaseException 也要放行——捕获 Exception 会让 Ctrl-C / 超时杀不掉推演。"""
    buf = io.StringIO()
    with pytest.raises(KeyboardInterrupt):
        with contextlib.redirect_stdout(buf):
            with stage("unit.interrupt"):
                raise KeyboardInterrupt
    assert _parse(buf.getvalue().strip())["ok"] == "0"


def test_unserializable_field_does_not_break_the_block():
    """② 字段里塞了个 __str__ 会炸的对象，主链路照样跑完。"""

    class Hostile:
        def __str__(self):
            raise RuntimeError("nope")

    done = []
    # 不应抛出——埋点失败是埋点自己的事
    with stage("unit.hostile", bad=Hostile()):
        done.append(True)
    assert done == [True], "埋点异常不能影响被测代码块的执行"


def test_values_with_spaces_do_not_break_parsing():
    """③ 空格会破坏"空格切分"这个解析约定，必须转义掉。"""
    out = _capture(lambda: _run_spaces()).strip()
    f = _parse(out)
    assert " " not in f["page"]
    assert f["page"] == "a_b_c"


def _run_spaces():
    with stage("unit.spaces", page="a b c"):
        pass


def test_none_fields_are_omitted():
    out = _capture(lambda: _run_none()).strip()
    assert "note=" not in out


def _run_none():
    with stage("unit.none", note=None):
        pass


def test_disabled_by_env_is_silent(monkeypatch):
    monkeypatch.setenv("SLIDERULE_ENRICH_TIMING", "0")
    assert timing_enabled() is False
    out = _capture(lambda: _run_ok())
    assert out == "", "关掉开关后不应有任何输出"


def test_enabled_by_default(monkeypatch):
    """默认必须开——这个模块存在的理由就是成功路径原本完全静默。"""
    monkeypatch.delenv("SLIDERULE_ENRICH_TIMING", raising=False)
    assert timing_enabled() is True


def test_attempts是预算_used才是次数():
    """两个字段挨着打、名字都像次数，读反过一次，所以钉住语义。

    ## 出处（2026-08-11）

    `stage=model.generate … attempts=2 … used=1` 这行里，`attempts` 是调用方
    **进入阶段之前**填的重试预算（v5_llm_generate.py：`attempts = 1 if
    use_parallel else 2`），不管这一趟成功失败都恒等于那个配置值；真正试了几次
    记在 `used`（成功时写 `attempt + 1`）。

    当时有人（我）连着六趟把 `attempts=2` 读成"每趟都重试了一次"，据此推断
    "每次生成白花一倍时间"，还论证了"这不是抖动，抖动会有成功有失败"——而同一行
    的 `used=1` 一直写着答案，七趟全是 1，即每趟都是第一次就成功。结论完全相反。

    注释挡不住下一个人，所以做成用例：**预算 2 而只试了 1 次时，两个字段必须
    同时出现且不相等**——这正是当时那条日志的形状。
    """
    out = _capture(lambda: _run_budget_2_used_1())
    f = _parse([l for l in out.strip().splitlines() if l][0])
    assert f["attempts"] == "2", "预算字段没打出来，读日志的人就只能猜了"
    assert f["used"] == "1", "实际次数字段没打出来"
    assert f["attempts"] != f["used"], (
        "这条用例要复现的正是「预算 ≠ 实际」那种行——两个数相等就演示不出区别了"
    )
    assert f["ok"] == "1"


def _run_budget_2_used_1():
    # 复刻 v5_llm_generate 的形状：预算在进入时给定，实际次数在成功分支写回
    with stage("unit.retry", attempts=2) as st:
        for attempt in range(2):
            st["used"] = attempt + 1
            break  # 第一次就成功


def test_整段失败时没有used字段_不能当成只试了一次():
    """`used` 只在成功分支写。缺席意味着"没走到成功"，不是"试了一次"。

    统计重试率时按 `used=` grep，缺席的那些要单独看 `ok=0`——把缺席默认成 1
    会把彻底失败的那批算成"一次成功"，正好把最该看的样本抹掉。
    """
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        with pytest.raises(RuntimeError):
            with stage("unit.retry.fail", attempts=2):
                raise RuntimeError("boom")
    f = _parse([l for l in buf.getvalue().strip().splitlines() if l][0])
    assert f["ok"] == "0"
    assert f["attempts"] == "2", "预算照打——它跟成败无关"
    assert "used" not in f, (
        "整段失败却打出了 used，那会让『试了几次』变得不可信"
    )
