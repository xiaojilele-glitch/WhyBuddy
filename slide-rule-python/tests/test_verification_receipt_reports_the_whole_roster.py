"""收据必须报满整张名单，失败必须带上归因。

2026-09-17 生产那趟（pvr-124797421db4de58ab4cb56fee6b040a26bffa06）的原样形态：

    assertions   10 条，而 react-vite-tasks@1 的名单是 13 条
    缺的三条     anonymous_api_forbidden / no_page_errors / no_failed_requests
    三条 reader_* status=failed，detail / expected / actual **全是 null**
    errorCode    project_browser_timeout
    验收 operation 事件流  {"events":[],"nextSeq":0}

于是"闸红了"是真的，"为什么红"查不出来：
  · 少掉的三条是被全局超时切的，但收据里"被切掉"和"这套本来就只有 10 条"完全同形；
  · reader_login 是等不到元素超时，还是真的登进去了但角色不对——detail 是 null，只能猜。

⚠ 这个文件的判据**喂生产那一发的原样载荷**（§一之二），不自己拼一个好看的。
   下面 production_receipt() 里的 id 和 status 是从线上记录抄的。
"""
import base64

import pytest

from services.project_browser_provider import (
    DETAIL_CODES, RUNNER_VERSION, SUITE_VERSION, TASK_EXPECTED, decode_result,
)
from services.project_verification_gate import SUITE_ASSERTIONS

TASKS = "react-vite-tasks@1"
REVISION = "prv-" + "a" * 32
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")

# 线上那趟的十条，顺序与 status 原样照抄。
PRODUCTION_TEN = [
    ("setup_admin", "passed"), ("writer_login", "passed"), ("task_create", "passed"),
    ("task_edit", "passed"), ("task_filter", "passed"), ("task_refresh", "passed"),
    ("reader_create", "passed"), ("reader_login", "failed"),
    ("reader_ui_readonly", "failed"), ("reader_api_forbidden", "failed"),
]


def decode(receipt):
    return decode_result(__import__("json").dumps(receipt), revision=REVISION,
                         verification_id="verification-1", suite_version=receipt["suiteVersion"])


def envelope(assertions, *, status, error_code, suite=TASKS):
    return {"verificationId": "verification-1", "revision": REVISION, "suiteVersion": suite,
            "runnerVersion": RUNNER_VERSION, "status": status, "errorCode": error_code,
            "assertions": assertions,
            "artifacts": {"tasks-created.png": base64.b64encode(PNG).decode()},
            "cleanupConfirmed": True, "revisionBefore": REVISION, "revisionAfter": REVISION}


def production_receipt():
    """线上那趟的原样收据：十条，失败的不带 detail。"""
    return envelope([{"id": key, "status": value} for key, value in PRODUCTION_TEN],
                    status="failed", error_code="project_browser_timeout")


def repaired_receipt():
    """修好之后产出侧会发的形状：名单报满，失败带归因。"""
    recorded = {key: value for key, value in PRODUCTION_TEN}
    items = []
    for key in sorted(SUITE_ASSERTIONS[TASKS]):
        status = recorded.get(key, "not_run")
        item = {"id": key, "status": status}
        if status == "failed":
            item["detail"] = "timeout"
        items.append(item)
    return envelope(items, status="failed", error_code="project_browser_timeout")


def test_生产那趟的原样收据现在会被收据闸拒绝():
    """正向：复刻线上 10/13 那一发——少报名单就是 output_invalid。

    ⚠ 这条是整个文件的锚。把 decode_result 里 `seen != required` 那条删掉，
      它必须变红（§2）。
    """
    assert len(PRODUCTION_TEN) == 10
    # 2026-09-18：reader_login 拆成两条后名单是 14；锚点仍是"报少了就红"。
    assert len(SUITE_ASSERTIONS[TASKS]) == 14
    assert decode(production_receipt())["errorCode"] == "project_browser_output_invalid"


def test_报满名单并带上归因的收据会被放行():
    """反向：证明上一条红的原因是"少报+没归因"，不是"这套收据本来就过不了"。"""
    decoded = repaired_receipt()
    result = decode(decoded)
    assert result["errorCode"] == "project_browser_timeout"
    assert result["status"] == "failed"
    assert {item["id"] for item in result["assertions"]} == set(SUITE_ASSERTIONS[TASKS])


def test_没跑到的断言显式记一笔而不是消失():
    result = decode(repaired_receipt())
    missing = {item["id"] for item in result["assertions"] if item["status"] == "not_run"}
    # 线上被超时切掉的正是这三条。
    assert missing == {"reader_api_session", "anonymous_api_forbidden",
                       "no_page_errors", "no_failed_requests"}


def test_失败的断言必须带归因():
    result = decode(repaired_receipt())
    failed = [item for item in result["assertions"] if item["status"] == "failed"]
    assert {item["id"] for item in failed} == {"reader_login", "reader_ui_readonly", "reader_api_forbidden"}
    assert all(item["detail"] in DETAIL_CODES for item in failed)


def test_失败却不带归因的收据不许进来():
    """反向：名单报满了，但失败条目把 detail 摘掉——仍然是非法收据。"""
    receipt = repaired_receipt()
    for item in receipt["assertions"]:
        item.pop("detail", None)
    assert decode(receipt)["errorCode"] == "project_browser_output_invalid"


@pytest.mark.parametrize("detail", ["boom", "", "timeout ", "TIMEOUT", None])
def test_词表之外的归因不许进来(detail):
    """detail 是封闭词表。收据的每个字节都来自模型生成的沙盒应用，
    自由文本会把任意 DOM 文本带进证据链。"""
    receipt = repaired_receipt()
    for item in receipt["assertions"]:
        if item["status"] == "failed":
            item["detail"] = detail
    assert decode(receipt)["errorCode"] == "project_browser_output_invalid"


@pytest.mark.parametrize("status", ["passed", "not_run"])
def test_没失败的断言不许带归因(status):
    receipt = repaired_receipt()
    for item in receipt["assertions"]:
        if item["status"] == status:
            item["detail"] = "timeout"
            break
    assert decode(receipt)["errorCode"] == "project_browser_output_invalid"


def test_通过的收据里不许混进没跑的断言():
    """passed 只能由整张名单全绿构成——not_run 混进来就是伪造绿灯（§七 fail-closed）。"""
    items = [{"id": key, "status": "passed"} for key in sorted(SUITE_ASSERTIONS[TASKS])]
    items[0]["status"] = "not_run"
    receipt = envelope(items, status="passed", error_code=None)
    receipt["artifacts"]["tasks-reader.png"] = base64.b64encode(PNG).decode()
    assert decode(receipt)["errorCode"] == "project_browser_output_invalid"


def test_blocked_不要求报满名单():
    """套件根本没起来的时候名单是空的，那是另一回事，不该跟"跑了但被切"混为一谈。"""
    receipt = envelope([], status="blocked", error_code="project_browser_input_invalid")
    assert decode(receipt)["errorCode"] == "project_browser_input_invalid"
    assert decode(receipt)["status"] == "blocked"


def test_计数器套件同样要报满名单():
    """§4：两套判据共用一个收据闸，别只修 tasks 那套。"""
    counter = sorted(SUITE_ASSERTIONS[SUITE_VERSION])
    full = [{"id": key, "status": "passed"} for key in counter[:-1]]
    full.append({"id": counter[-1], "status": "failed", "detail": "assertion"})
    art = {"before.png": base64.b64encode(PNG).decode()}

    ok = envelope(full, status="failed", error_code="project_browser_assertion_failed", suite=SUITE_VERSION)
    ok["artifacts"] = art
    assert decode(ok)["errorCode"] == "project_browser_assertion_failed"

    # 同一份收据，只摘掉一条**通过**的断言：失败条目还在，
    # 所以红只可能是"名单没报满"，不会是"failed 却没有失败项"。
    short = envelope(full[1:], status="failed", error_code="project_browser_assertion_failed", suite=SUITE_VERSION)
    short["artifacts"] = art
    assert any(item["status"] == "failed" for item in short["assertions"])
    assert decode(short)["errorCode"] == "project_browser_output_invalid"


# —— 失败断言要说清楚拿到了什么 ——
# ⚠ 2026-09-17 第二趟真机（prj-04985acd…）：reader_login 的 detail=assertion，
#   于是知道「是值不对，不是等不到元素」，但**不知道值是什么**。拿到 writer
#   （登录串号）和拿到 none（session 查不到人）是两个完全不同的 bug。
#   下面这批钉住：能带值，但只能带我们自己产生的短标记。


def observed(assertion_id, expected, actual):
    receipt = repaired_receipt()
    for item in receipt["assertions"]:
        if item["id"] == assertion_id:
            item["status"] = "failed"
            item["detail"] = "assertion"
            item["expected"], item["actual"] = expected, actual
    return receipt


def test_只读登录可以带上真正拿到的角色():
    result = decode(observed("reader_login", "reader", "writer"))
    assert result["errorCode"] == "project_browser_timeout"
    row = next(item for item in result["assertions"] if item["id"] == "reader_login")
    assert row["expected"] == "reader" and row["actual"] == "writer"


@pytest.mark.parametrize("actual", ["writer", "reader", "none", "403", "401", "200", "unexpected_value"])
def test_词表之内的观测值都放行(actual):
    assert decode(observed("reader_login", "reader", actual))["errorCode"] == "project_browser_timeout"


@pytest.mark.parametrize("actual", [
    "provider-secret", "https://private.example/?ticket=secret", "writer ", "WRITER",
    "1234", "12", "", "reader\n", "admin", 403, None, True,
])
def test_词表之外的观测值一律拒收(actual):
    """收据里的每个字节都来自沙盒里模型生成的应用。自由文本不许进证据链。"""
    result = decode(observed("reader_login", "reader", actual))
    assert result["errorCode"] == "project_browser_output_invalid"
    assert "secret" not in __import__("json").dumps(result)


def test_每个断言只许声明自己那几个预期值():
    # reader_login 只许说自己要 reader；拿 403 来冒充就是收据被改过。
    assert decode(observed("reader_login", "403", "401"))["errorCode"] == "project_browser_output_invalid"
    assert decode(observed("reader_api_forbidden", "403", "401"))["errorCode"] == "project_browser_timeout"


def test_没被授权带值的断言不许带值():
    """§3 反向：名单里在、但不在 TASK_EXPECTED 里的 id，带上 expected 就非法。"""
    assert "task_filter" not in TASK_EXPECTED
    assert decode(observed("task_filter", "reader", "writer"))["errorCode"] == "project_browser_output_invalid"


def test_通过的断言不许带观测值():
    receipt = repaired_receipt()
    row = next(item for item in receipt["assertions"] if item["status"] == "passed")
    row["expected"], row["actual"] = "writer", "reader"
    assert decode(receipt)["errorCode"] == "project_browser_output_invalid"
