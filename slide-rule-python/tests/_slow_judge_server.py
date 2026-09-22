# -*- coding: utf-8 -*-
"""判据专用启动器：把 judge_turn 换慢，再起真 uvicorn。

⚠ 为什么要单独一个启动器，而不是在判据进程里用 ASGITransport：
  **在同一个事件循环里量不了这个循环被阻塞**——循环被占死时，测量代码自己
  也没在跑；等它能跑了阻塞已经结束。实测：async 版本下慢请求确实串行占了
  2.01s，而同进程采样只采到 1 次、量到 0.001s，判据全绿。
  真机那次能测出 10.5s，正是因为 curl 在另一个进程。

这里只 patch 一个函数、不改任何生产代码。
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SLOW = float(os.environ.get("SLOW_JUDGE_SECONDS", "1.0"))

from services import intake_judge  # noqa: E402


class _Judgement:
    def to_dict(self):
        return {"action": "proceed", "reason": "test-stub"}


def _slow_judge(*_a, **_k):
    time.sleep(SLOW)  # 占住线程；对事件循环而言等价于等 LLM 的 socket
    return _Judgement()


intake_judge.judge_turn = _slow_judge

import uvicorn  # noqa: E402

from app import app  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="error")
