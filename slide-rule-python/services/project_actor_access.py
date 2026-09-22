"""Current account authority shared by control, execution and preview access.

2026-09-13: disabling an owner stopped new authenticated control requests, but
existing preview credentials only checked session ownership and plan approval.
They therefore remained usable after the same account lost project access.
Account state must be read independently of the project revision: source sync
temporarily spans two versions while the runtime owner still holds its lease.

⚠ 2026-09-16 真机（会话 sr-20260916212612-6N7V2BZ6XS）：工程建完、check/build/
  test 三个全过，`project_start` 提交成功，运行时却在 worker 的**第一次
  check() 上**就死了：

      runtime.state seq=1  status=stopping  errorCode=project_actor_access_revoked
      runtime.state seq=2  status=failed    processId=null  previewUrl=null

  而同一个账号、同一份进程环境事后连判三次全过（rollout=internal、
  is_superuser=True、is_active=True）。**账号一秒都没被吊销过。**

  原因是这道守卫把两种「查不到」混成了一种：

      except Exception:        -> project_actor_unavailable   （查库抛了，可重试）
      if user is None: ...     -> project_actor_access_revoked（查到空，判定吊销）

  身份存储是**远程 HTTPS SQL 网关**。它抖一下回「0 行」不是异常，落进第二条；
  而 get_by_id_for_auth 当时**连 None 一起缓存 5 秒**，于是这 5 秒里每一次
  check() 都判吊销，正在跑的工程被直接掐掉，错误还甩锅给账号。

  两处一起修（另一处在 identity_store：空结果不再进缓存）。这里的修法是
  **判定吊销之前再无缓存复查一次，两次都判吊销才算数**，并且落一行日志——
  原来这道守卫一行日志都不打，所以真机上得穿三层（后端日志→transcript→
  操作记录）才找得到它。

  ⚠ 复查**只降低误判，不放宽结论**：账号真被停用时，复查同样判吊销，仍然
    立刻失效——上面 2026-09-13 那条性质原样保留。复查本身失败也维持原判
    （fail-closed），不借机放行。
"""

import logging

from services.identity_store import get_identity_store
from services.project_access import project_access_enabled

log = logging.getLogger(__name__)


def _actor_is_authorized(user, owner_id: str) -> bool:
    return not (user is None or user.id != owner_id or not user.is_active
                or not project_access_enabled(user))


def authorize_project_actor(owner_id: str) -> None:
    store = get_identity_store()
    try:
        user = store.get_by_id_for_auth(owner_id)
    except Exception:
        # Provider/SQL diagnostics can contain connection credentials. A lookup
        # outage cannot keep an old grant valid or expose those diagnostics.
        raise PermissionError("project_actor_unavailable") from None
    if _actor_is_authorized(user, owner_id):
        return
    # 无缓存复查。拿不到 get_by_id（测试替身）或复查自己炸了 -> 维持原判。
    fresh = None
    try:
        fresh = store.get_by_id(owner_id)
    except Exception:
        fresh = None
    if _actor_is_authorized(fresh, owner_id):
        log.warning("project actor recheck cleared a stale empty lookup owner=%s", owner_id)
        return
    log.warning(
        "project actor access denied owner=%s cached_found=%s fresh_found=%s",
        owner_id, user is not None, fresh is not None,
    )
    raise PermissionError("project_actor_access_revoked")
