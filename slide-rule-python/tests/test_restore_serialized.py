"""同一会话的版本回退必须串行（2026-08-16 线上实测）。

前端加了 in-flight 闸之后仍要有这一层：闸只挡住"同一个浏览器标签连点"，
挡不住多标签、刷新后重放、或者直接打接口。而回退**不是只读**——它重建闭环
并写回会话，两个请求交叠就是读改写竞态。

真机实测：三个并发 POST 全部被后端接受、各自跑完，没有任何互斥。
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import sliderule_full as sr  # noqa: E402


def _skip_ownership(monkeypatch) -> None:
    """把归属守卫摘掉。

    ⚠ 2026-09-06：`restore_model_version` 补了归属判定（此前它连 `viewer`
      参数都没有，任何人都能把别人会话的模型换成某个历史版本）。这两条用例
      按位置只传 `(sid, version_id)`，签名一变就 TypeError —— 线程里抛的异常
      不会让用例红，只会让 `peak` 停在 0，报出来是"没有串行化"，
      **指向一个不存在的病**。

      这里显式摘掉守卫而不是给它喂一个合法访问者：这两条测的是**锁的粒度**，
      鉴权由 tests/test_runs_ownership.py 单独钉。摘得明白比混在一起好。
    """
    monkeypatch.setattr(sr, "_auth", lambda *_a, **_k: None)
    monkeypatch.setattr(sr, "_require_run_session", lambda *_a, **_k: None)


def test_same_session_shares_one_lock_and_different_sessions_do_not():
    a1, a2 = sr._restore_lock("s-a"), sr._restore_lock("s-a")
    b = sr._restore_lock("s-b")
    assert a1 is a2, "同一会话两次取到不同的锁 = 没锁"
    assert a1 is not b, "不同会话共用一把锁 = 互相排队，白白变慢"


def test_concurrent_restores_do_not_overlap(monkeypatch):
    """两个并发回退不许出现执行区间重叠。

    判据落在**重叠**而不是"跑完了几次"：没有互斥时两个请求会同时进入临界区，
    这正是读改写竞态的形状；串行化之后区间必须首尾相接。
    """
    inside = []
    peak = 0
    lock = threading.Lock()

    def slow(sid, version_id):
        nonlocal peak
        with lock:
            inside.append(1)
            peak = max(peak, len(inside))
        time.sleep(0.25)
        with lock:
            inside.pop()
        return {"restored": True}

    monkeypatch.setattr(sr, "_restore_model_version_locked", slow)
    _skip_ownership(monkeypatch)

    ts = [threading.Thread(target=sr.restore_model_version,
                           args=("s-race", "mv-1", None))
          for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]

    assert peak == 1, f"同一会话有 {peak} 个回退同时在临界区里 —— 没有串行化"


def test_different_sessions_still_run_in_parallel(monkeypatch):
    """不同会话之间不许互相排队 —— 这是上面那条的代价判据。

    一把全局大锁同样能让 peak==1，但会把不相干的用户串起来。
    """
    peak = 0
    inside = []
    lock = threading.Lock()

    def slow(sid, version_id):
        nonlocal peak
        with lock:
            inside.append(sid)
            peak = max(peak, len(inside))
        time.sleep(0.25)
        with lock:
            inside.pop()
        return {"restored": True}

    monkeypatch.setattr(sr, "_restore_model_version_locked", slow)
    _skip_ownership(monkeypatch)

    ts = [threading.Thread(target=sr.restore_model_version,
                           args=(f"s-{i}", "mv-1", None))
          for i in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]

    assert peak == 3, f"不同会话被串起来了（并发度 {peak}）—— 锁的粒度太粗"
