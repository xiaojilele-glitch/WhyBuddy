"""会话 id 不能碰撞 —— 撞了就是数据直接丢失。

## 这条测试为什么存在

2026-08-06 并发跑 5 个真实话题，实测：**5 个会话只拿到 3 个 id**。
原实现是 `f"sr-{datetime.now().strftime('%Y%m%d%H%M%S')}"` —— 秒级时间戳、
没有随机位、没有碰撞检查，同一秒内建的会话拿到完全一样的 id，后写的把先写
的整个盖掉。「独立书店」和「宠物寄养」两个话题的模型双双变成了「农机租赁」的，
库里连它们的原始目标文本都查不到了。

下游那套 lastTurnId 单调守卫拦不住：它防的是**同一个会话**被陈旧快照覆盖，
而在这套设计里 id 就是身份——不同会话共用一个 id 时，它只会认为"这是同一个
会话的新一轮"，老老实实合并。所以唯一能修的地方是 id 生成。

方案结构照 ULID 规范（github.com/ulid/spec）：时间戳在前保证字典序即时间序，
加密随机在后保证唯一。
"""

import concurrent.futures as cf
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.slide_rule_session import _ID_ALPHABET, _new_session_id


def test_same_second_ids_do_not_collide():
    """同一秒内批量生成必须零重复——这就是当初炸掉的那个场景。"""
    ids = [_new_session_id() for _ in range(20000)]
    # 确认这批确实落在很少的几秒里，否则这条测试等于没测到同秒场景
    seconds = {i.rsplit("-", 1)[0] for i in ids}
    assert len(seconds) < 20, f"生成得太慢，没形成同秒压力（跨了 {len(seconds)} 秒）"
    assert len(set(ids)) == len(ids), "同一秒内出现重复 id"


def test_concurrent_creation_keeps_every_goal():
    """并发建会话时每个话题的目标都得保住——原 bug 的直接表现是目标被覆盖。"""
    from services import slide_rule_session as S

    topics = ["社区诊所", "独立书店", "宠物寄养", "农机租赁", "健身私教"]
    with cf.ThreadPoolExecutor(max_workers=len(topics)) as pool:
        states = list(pool.map(lambda t: S.create_session(f"给{t}做一套系统"), topics))

    assert len({s.sessionId for s in states}) == len(topics), "并发创建仍在共用 id"
    assert len({s.goal["text"] for s in states}) == len(topics), "有话题的目标被覆盖了"


def test_id_stays_within_the_screenshot_cache_key_budget():
    """长度上限 32 —— 不是美观问题，是截图缓存键会截断。

    server/routes/sliderule-screenshot-device.ts:19,27 拿 `sessionId.slice(0, 32)`
    当缓存键。超过 32 的两个 id 只要前 32 位相同就会共用一张截图。
    """
    for _ in range(200):
        assert len(_new_session_id()) <= 32


def test_id_keeps_the_readable_timestamp_prefix():
    """时间戳前缀要保留：它进日志、进工单，排查时靠肉眼读。

    也是不换成完整 ULID 的原因之一——ULID 以 '0' 开头，会**排在**所有存量
    `sr-2026…` id 前面，跨格式的字典序会悄悄反转。
    """
    sid = _new_session_id()
    assert sid.startswith("sr-")
    stamp = sid.split("-")[1]
    # 能被解析回时间，且就是此刻
    parsed = datetime.strptime(stamp, "%Y%m%d%H%M%S")
    assert abs((datetime.now() - parsed).total_seconds()) < 120


def test_suffix_uses_crockford_base32_only():
    """字母表去掉了 I/L/O/U —— 这些 id 会被人念出来、抄进工单。

    另外 `b % 32` 不能有取模偏置：256 是 32 的整数倍，正好均匀。
    """
    assert set("ILOU").isdisjoint(_ID_ALPHABET)
    assert len(_ID_ALPHABET) == 32
    seen: set[str] = set()
    for _ in range(500):
        seen.update(_new_session_id().split("-")[2])
    assert seen <= set(_ID_ALPHABET), f"后缀出现了字母表外的字符: {seen - set(_ID_ALPHABET)}"


def test_collision_probe_recognises_a_real_hit():
    """存在性检查不能有假阳性。

    第一版写成 `load_session_record(session_id) is None` —— 而那个函数查不到时
    返回的是 {"ok": False, "error": "not_found"}（persistence.py:581），不是 None。
    于是恒真判定"撞了"，白跑满重试、每次多打几趟库，日志还骗人说撞了。
    """
    from services.persistence import load_session_record

    missing = load_session_record("sr-绝不存在-ZZZZZZZZZZ")
    assert missing is not None, "契约变了：这个函数现在返回 None 了，检查逻辑要跟着改"
    assert missing.get("ok") is False
