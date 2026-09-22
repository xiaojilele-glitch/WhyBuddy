"""复刻（fork）出来的会话：归属、话题、耗时。

三条都是 2026-08-06 用户实测反馈出来的，且都不是"偶发"，是必现。

## ① 副本会话没有归属

fork 里建 V5SessionState 时没传 ownerId → 副本会话**无主**。而 2026-08-06
的会话隔离把无主会话收紧成"只有超管看得见"，于是复刻完的人自己都打不开
刚复刻出来的东西。加归属列那次没有回头检查还有谁在建会话。

## ② 副本的话题是源应用的（**已在能力侧修好**，这里只留回退教训）

用户原话：「我发布的是从文献到引用的话题，回答的是电动车方面的内容，
但是生成的应用又却是对的。」——各能力吃 state.goal（继承来的电动车），
五系统生成吃 user_instruction（本人的新话题），过程和结果讲两件事。

真因在 execute_v5_capability 没有 user_instruction 参数，修法是
compose_capability_topic（话题与本轮要求并存、分别打标签，aa284b5）。

这个文件里试过的那版（第一条指令顶掉继承来的话题）是错的，实测让生成整个
不跑了，已回退——理由见 routes/sliderule_full.py 里那段说明。

## ③ fork 慢：一次复刻打 14 次 Wikipedia

剖析（scratchpad/profile_fork.py）：

    _ensure_runtime_closure_evidence   11027 ms   占总耗时 99.3%
      └ 14 次 Wikipedia 请求             9910 ms

复刻的是一份已推演完的模型，重建闭环证据不需要重新去外网找证据。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── ② 副本会话"过程串话题"：真因已在能力侧修好，这里钉回退后的形状 ──
def test_fork_marks_goal_as_inherited():
    """副本的话题如实标注成"继承来的"，但**不改变行为**。

    真因不在这个文件：execute_v5_capability 没有 user_instruction 参数。
    修法是 compose_capability_topic（话题与本轮要求并存、分别打标签，
    aa284b5），这里只负责钉住"别再用顶替的办法解决它"。

    试过一版"本人第一条指令顶掉继承来的话题"，实测把生成炸了：
    _ensure_runtime_closure_evidence 里 `instruction != goal_text` 是进入
    refine 的条件，话题被顶成和指令一样之后走 else 分支直接 return，
    整趟推演 23.7 秒跑完、模型原地不动（实测 goal 变成了「学术文献引用
    管理平台」而 modelVersions 里仍然只有那份健身房模型）。

    修好了"过程串话题"，代价是"结果根本不生成"——比原来更糟，已回退。
    完整分析见 routes/sliderule_full.py 里 _require_login 上方那段。

    这个字段留着：它如实标注了会话话题的来历，本身是有用的信息。
    """
    import inspect

    from routes import sliderule_full

    src = inspect.getsource(sliderule_full.fork_generated_app)
    assert '"inherited": True' in src, "继承来的话题要如实标注"
    # 反向断言：不能再有任何地方**真的去改**话题。
    # 只看定义与调用，不看注释——那段回退说明里必然提到这个名字。
    full = inspect.getsource(sliderule_full)
    code = "\n".join(
        line for line in full.splitlines() if not line.lstrip().startswith("#")
    )
    assert "def adopt_user_goal" not in code, "函数已回退，不该再有定义"
    assert "adopt_user_goal(" not in code, (
        "要重新引入必须先解决 refine 分支被绕过的问题（见回退说明）"
    )


# ── ① 副本会话必须有主 · ③ 不打外网 ───────────────────────────────
def test_fork_route_sets_owner_and_suppresses_web_search():
    """这两件事都在 fork 路由里，用源码断言钉住——它们一旦被删掉，
    表现分别是"复刻完自己打不开"和"复刻要等十几秒"，都不会报错。"""
    import inspect

    from routes import sliderule_full

    src = inspect.getsource(sliderule_full.fork_generated_app)
    assert "ownerId=viewer.id" in src, "副本会话必须归复刻的人所有"
    assert "with suppress_web_search():" in src, "重建闭环证据不该打外网"
    assert '"inherited": True' in src, "继承来的话题要打标记"
    # 11 秒的同步活儿不能占着事件循环——那会卡住所有并发请求（含推演 SSE）
    assert "asyncio.to_thread(_init_fork_session)" in src, "会话初始化要挪出事件循环"


# ── ③ 的机制本身 ──────────────────────────────────────────────
def test_suppress_web_search_is_request_scoped(monkeypatch):
    """必须是请求域的，不能是全局开关。

    全局关等于把正常推演的外部证据也一起关掉；而并发下一个 fork 不该影响
    别人正在跑的推演。
    """
    from services.mcp_tools import suppress_web_search, web_search_enabled

    # 基线跟着环境走（测试环境可能本来就把 SLIDERULE_WEB_SEARCH 关了），
    # 这里钉的是**这个上下文管理器造成的差值**，不是某个绝对值。
    #
    # ⚠️ 必须走 monkeypatch，不能直接 `os.environ.pop`（2026-08-09 修）。
    # 原来是裸 pop，**跑完不还原**：conftest 把这个变量钉成 off 是为了让全套件
    # 绝不外呼，被这里清掉之后，后面所有测试都在"外呼开着"的环境里跑。
    #
    # 后果不是这条测试红，是**别的文件红**：
    #     test_mcp_tools::test_disabled_by_conftest_default   直接断言它是 off
    #     test_vector_rag 那 4 条                              retrieve_evidence 走了另一条分支
    # 而这 6 条**单独跑全绿**，只有全量跑才红——最难查的那种。
    monkeypatch.delenv("SLIDERULE_WEB_SEARCH", raising=False)
    baseline = web_search_enabled()
    assert baseline is True, "清掉环境变量后默认应当是开的"

    with suppress_web_search():
        assert web_search_enabled() is False
    # 退出即恢复，异常路径也要恢复（contextmanager 的 finally）
    assert web_search_enabled() is baseline

    try:
        with suppress_web_search():
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert web_search_enabled() is baseline, "异常退出后必须恢复，否则整个进程再也搜不了"


def test_web_search_returns_none_when_suppressed():
    """停用时返回 None —— 调用方据此回落本地 RAG 并如实标注检索方式，
    不会冒充外部证据。"""
    from services.mcp_tools import suppress_web_search, web_search

    with suppress_web_search():
        assert web_search("任意查询", 6) is None
