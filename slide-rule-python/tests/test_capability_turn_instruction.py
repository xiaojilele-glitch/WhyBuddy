"""能力执行要同时看见"会话话题"和"这一轮用户说了什么"。

## 这组测试为什么存在

2026-08-06 用户实测：「我发布的是从文献到引用的话题，回答的是电动车方面的
内容，但是生成的应用又却是对的。」

机制：从应用中心 fork 出来的副本，`goal.text` 继承自源应用。而
`execute_v5_capability` **压根没有 user_instruction 这个参数**，只读
`state.goal`：

    goal = state.goal.get("text", "")
    evidence = retrieve_evidence(goal + " for " + capability_id, top_k=10)
    content  = generate_with_rag(f"…{capability_id} on {goal}…", evidence)

于是各能力（evidence.search / route.generate / synthesis.merge…）全部按继承
来的旧话题干活 → 左侧推演过程整篇是电动车；五系统生成走另一条通道吃
user_instruction → 右侧应用是对的。过程与结果讲两件事。

新建会话里 goal == instruction，拿哪个都一样，所以这个洞一直没踩到。

## 为什么是"拼一起"而不是"当前轮顶替话题"

先试过顶替（adopt_user_goal），实测把生成整个跑没了：refine 的进入条件正是
`instruction != goal_text`，顶平之后条件永不成立，推演 23.7 秒空跑、模型
原地不动。已回退（见 routes/sliderule_full.py 里那段说明）。

而且"顶替"本身就不对：用户说「把到期提醒改成短信」时只拿这句去检索，模型
根本不知道这是个健身房系统，领域上下文全丢。

## 照的是哪家的做法

    CrewAI  translations/en.json + utilities/prompts.py:190-212
            role_playing: "Your personal goal is: {goal}"   长期目标
            task:         "Current Task: {input}"           这一轮
    LangChain v1  agents/factory.py:974
            system_prompt → 独立 SystemMessage 前置；用户这一轮的话仍是
            单独的 HumanMessage

两家都是并存 + 分别标注，没有一家用当前轮覆盖长期目标。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.v5_capability_executor import (  # noqa: E402
    compose_capability_topic,
    current_turn_instruction,
    turn_instruction,
)

GOAL = "给社区健身房做一套会员与私教管理系统"
NEW_TOPIC = "做一个学术文献引用管理平台"
REFINE = "把到期提醒改成短信"


# ── 拼装规则 ────────────────────────────────────────────────────
def test_new_topic_keeps_both():
    """换话题时两个都在——过程终于提到用户说的，同时不丢原始领域。"""
    out = compose_capability_topic(GOAL, NEW_TOPIC)
    assert GOAL in out
    assert NEW_TOPIC in out
    assert "本轮用户要求" in out, "这一轮的要求必须有标签，否则模型分不清两段"


def test_refine_keeps_domain_context():
    """精修时尤其不能只留指令。

    「把到期提醒改成短信」单独拿去检索/生成，模型不知道这是健身房系统——
    这正是"当前轮优先"那个形状的致命处。
    """
    out = compose_capability_topic(GOAL, REFINE)
    assert GOAL in out, "领域上下文必须保留"
    assert REFINE in out


def test_no_instruction_is_byte_identical_to_before():
    """多轮循环里引擎自推的那些轮次没有用户输入 —— 必须与从前逐字节一致。"""
    assert compose_capability_topic(GOAL, "") == GOAL
    assert compose_capability_topic(GOAL, "   ") == GOAL


def test_same_text_is_not_duplicated():
    """新建会话第一轮：话题就是指令。不能拼成两遍。

    这条保证了**绝大多数现有路径零变化**——只有 fork 那种继承来的会话
    才会真的走到拼接分支。
    """
    assert compose_capability_topic(GOAL, GOAL) == GOAL


def test_empty_goal_falls_back_to_instruction():
    """会话还没有话题（首轮尚未落盘）时，用户说的就是全部。"""
    assert compose_capability_topic("", NEW_TOPIC) == NEW_TOPIC
    assert compose_capability_topic("", "") == ""


# ── 请求域上下文 ────────────────────────────────────────────────
def test_turn_instruction_is_request_scoped():
    """并发下两趟推演不能互相看见对方的指令。

    这条链路上出过一模一样的事故：生成侧四个模块级全局变量在并发下串了
    用户内容，2026-08-06 才改成 ContextVar（见 test_request_scoped_state）。
    这里从一开始就用 ContextVar，不再重蹈。
    """
    assert current_turn_instruction() == ""
    with turn_instruction(NEW_TOPIC):
        assert current_turn_instruction() == NEW_TOPIC
        with turn_instruction(REFINE):
            assert current_turn_instruction() == REFINE
        assert current_turn_instruction() == NEW_TOPIC, "嵌套退出要回到上一层"
    assert current_turn_instruction() == ""


def test_turn_instruction_resets_on_exception():
    """异常路径也得复位，否则残留的指令会污染同进程的下一趟推演。"""
    try:
        with turn_instruction(NEW_TOPIC):
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert current_turn_instruction() == ""


def test_turn_instruction_is_stripped():
    assert compose_capability_topic(GOAL, f"  {NEW_TOPIC}  ").endswith(NEW_TOPIC)


# ── 两条推演入口都要接上 ────────────────────────────────────────
def test_both_drive_entries_set_the_context():
    """流式与非流式都要接。

    只接一条的后果刚在身份透传上踩过：前端走 SSE，非流式是回退路径，
    回退路径出问题最难发现，因为平时不走。
    """
    import inspect

    from services import v5_full_driver

    sync_src = inspect.getsource(v5_full_driver.drive_full_v5_session)
    stream_src = inspect.getsource(v5_full_driver.drive_full_v5_session_stream)
    assert "_turn_instruction(user_instruction)" in sync_src, "非流式入口漏了"
    assert "_turn_instruction(user_instruction)" in stream_src, "流式入口漏了"
    # 复位同样两条都要有，否则指令会泄漏到同进程的下一趟
    assert "_turn_ctx.close()" in sync_src
    assert "_turn_token.__exit__(None, None, None)" in stream_src


def test_llm_native_path_passes_the_real_user_message():
    """**主路径**：LLM 原生能力的 payload 里 USER_MESSAGE 要装用户真说的话。

    这条差点漏掉。第一版只改了 execute_v5_capability，而那是**回退路径**
    ——LLM 通道可用时（生产默认）走的是 _execute_round_capability →
    sliderule_llm.capabilities.execute_capability，payload 里
    `"userText": goal` 是写死的。

    实测证据：改完第一版之后跑真推演，7 个产物（Intent clarification /
    Structured critique / Risk analysis…）**全都还是旧话题**，因为它们
    根本没走我改的那条路。

    提示模板本身早就是对的（capabilities.py:259）：

        GOAL: {goal}
        USER_MESSAGE: {user_text}

    两槽结构与 CrewAI 的 role_playing/task 同形。槽位一直在，是调用方
    没往里装东西。
    """
    import inspect

    from services import v5_full_driver

    src = inspect.getsource(v5_full_driver._execute_round_capability)
    assert '"userText": current_turn_instruction() or goal' in src, (
        "USER_MESSAGE 必须装本轮用户的话；`or goal` 是无输入时的兜底"
    )
    assert '"userText": goal,' not in src, "不能再写死成 goal"


def test_executor_reads_the_context():
    """能力执行真的用了拼装结果，而不是又退回只读 goal。"""
    import inspect

    from services import v5_capability_executor

    src = inspect.getsource(v5_capability_executor.execute_v5_capability)
    assert "compose_capability_topic(goal, ask)" in src
    assert "retrieve_evidence(topic + " in src, "检索也要用拼装后的主题"
    assert "on {topic}" in src, "生成提示也要用拼装后的主题"
