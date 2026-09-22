"""网关拿 401 表达"账号池满了"时必须可重试——但真鉴权失败仍然不可重试。

2026-08-25 真机（健身房那趟）连挂四轮，每轮停在同一行：

    [llm-retry] 第 1/3 次失败（HTTP 401 不可重试）
    [v5_capability_executor] spec 生成失败（重问 2 次后）

`第 1/3` 是线索：重试预算给了 3 次，分类器判"不可重试"，烧掉 1 次就弃权。
抓响应体：{"error":{"message":"All available accounts exhausted",
"type":"server_error"}}——**type 是 server_error**，容量耗尽披了个 401 的壳。

这条测试锁两头，缺哪头都不行：
  正向 —— 容量型 401/403 必须 transient=True，否则重试预算继续白给；
  反向 —— 真鉴权 401 必须 transient=False，否则一把错 key 会被重试到天荒地老，
          fail-closed 退化成 fail-open。
只写正向那条，把 `status in (401, 403)` 整个删成"401 一律可重试"照样绿。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from sliderule_llm.client import _normalize_error, should_try_next_provider

# 真机原样抓下来的响应体，别改成"差不多的意思"——判据要咬住真实形态。
REAL_GATEWAY_BODY = '{"error":{"message":"All available accounts exhausted","type":"server_error"}}'


@pytest.mark.parametrize("status", [401, 403])
def test_capacity_exhausted_behind_auth_status_is_retryable(status: int) -> None:
    err = _normalize_error(status, REAL_GATEWAY_BODY)
    assert err.transient is True, "容量耗尽被判成不可重试 → 重试预算白给，整条推演断在中途"
    # call_llm_with_retry 的重试判据就是 error.transient（client.py 那句
    # `if not error.transient or attempt >= max_attempts: raise`），上面那条
    # 已经锁住；这里再锁 provider 链路也肯把它转给下一家。
    assert should_try_next_provider(err) is True
    # 文案不许喊"鉴权失败"：那会把排查的人送去查 key，而 key 是好的。
    assert "check api key" not in str(err).lower()


@pytest.mark.parametrize(
    "body",
    [
        '{"error":{"message":"No available accounts","type":"server_error"}}',
        "upstream capacity reached, try again later",
        '{"error":{"message":"quota exceeded"}}',
    ],
)
def test_other_capacity_phrasings_also_retryable(body: str) -> None:
    """盯语义（上游容量满了），不盯某家网关的某句话。"""
    assert _normalize_error(401, body).transient is True


@pytest.mark.parametrize(
    "body",
    [
        '{"error":{"message":"Invalid API key provided","type":"invalid_request_error"}}',
        "Unauthorized",
        "",
    ],
)
def test_real_auth_failure_stays_non_retryable(body: str) -> None:
    """反向判据：key 真错了，重试一万次也没用，必须原地失败。"""
    err = _normalize_error(401, body)
    assert err.transient is False, "真鉴权失败被判成可重试 → fail-closed 退化成 fail-open"
    assert should_try_next_provider(err) is False
    assert "check API key" in str(err)


def test_python_and_typescript_classifiers_agree_on_capacity_401() -> None:
    """成对实现：TS 侧 normalizeLLMError 是同一条规矩，只改一半会静默失效。

    这里不跑 TS，只锁"另一处确实也认容量型 401"——把 TS 那半改回
    `status === 403 && ...`（即 401 不再进限流分支）时，这条必须变红。
    """
    ts = Path(__file__).resolve().parents[2] / "server" / "core" / "llm-client.ts"
    src = ts.read_text(encoding="utf-8")
    # 先剥注释：本仓踩过"标识符同时出现在注释里 → 变异后照样绿"。
    body = "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith(("//", "*", "/*"))
    )
    rate_limit_branch = body.split("function normalizeLLMError(", 1)[1].split("if (status === 404")[0]
    head = rate_limit_branch.split("rate limited or out of quota", 1)[0]
    assert "401" in head, "TS 侧限流分支不再接纳 401 → 两处判定分叉，容量错误在 TS 路径上仍被当成鉴权失败"
