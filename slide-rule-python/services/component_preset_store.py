"""AI 组装出来的页面 —— 攒成按行业分的模板库。

## 这是什么

2026-08-08 用户描述的闭环（原话）：「我们有了三五百的组件，让 AI 对着三五百
个组件进行组装，相当于跟拆盲盒一样，你点了 AI 组装，它会在三五百个组件里面
抽盲盒，直接组装出一个页面，由 AI 判断它适合什么行业，直接添加到那个行业
里。AI 组装出来的预设，现在就是一个模板了。」

所以模板**不是手写的**。我此前手写过十套预设塞进目录 JSON，方向错在根上：
那十套是死的、每次一样，而且其中三套推荐的积木在真实应用里会被渲染层直接
丢掉——手写的东西没法验证，也不会自己变多。

正确的形状是攒出来的：组装一次 → AI 判行业 → 存一条。组件从 14 个长到三五百
个的过程中，同一个按钮抽出来的东西自然越来越丰富，模板库跟着长。

## 为什么单独一张表而不是塞进 generated_app

generated_app 存的是**用户的应用**：有归属、有版本血缘（root_id/parent_id）、
会被复刻、进应用中心。模板是**素材**：没有归属（谁都能看）、没有血缘、不进
应用中心、可以被批量清理重攒。

两者混在一张表里，"我的应用"列表就得处处带一个 where 把模板排除掉——那种
过滤条件迟早会有人漏写一处，然后用户在应用中心看见一堆机器攒的模板。

## 与 identity_store 同一套后端形制

`_x` 是执行器（SQLAlchemy / Neon HTTP / 自定义网关三选一），差异只在 SQL
怎么发出去。DDL 分 sqlite 与 PG 两份，因为 jsonb 和 timestamptz 在 sqlite 上
不存在。
"""

from __future__ import annotations

import json
import secrets
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

TABLE = "component_preset"

_DDL_PG = f"""
create table if not exists {TABLE} (
    id varchar(36) primary key,
    name varchar(160),
    industry varchar(80),
    page_kind varchar(32),
    block_count integer,
    blocks_json jsonb,
    source varchar(24),
    created_at timestamptz
)
"""

_DDL_SQLITE = f"""
create table if not exists {TABLE} (
    id varchar(36) primary key,
    name varchar(160),
    industry varchar(80),
    page_kind varchar(32),
    block_count integer,
    blocks_json text,
    source varchar(24),
    created_at timestamp
)
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ComponentPresetStore:
    """模板库。三种后端共用这一个类，差异只在 `_x` 怎么执行 SQL。"""

    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._is_sqlite = is_sqlite
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)
        self._x.execute(
            f"create index if not exists ix_{TABLE}_industry on {TABLE} (industry)"
        )

    def save(
        self,
        *,
        name: str,
        industry: str,
        page_kind: str,
        blocks: List[Dict[str, Any]],
        source: str = "assemble",
    ) -> Dict[str, Any]:
        pid = secrets.token_urlsafe(16)
        p = self._x.ph
        self._x.execute(
            f"insert into {TABLE} (id, name, industry, page_kind, block_count,"
            f" blocks_json, source, created_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)},{p(5)},{p(6)},{p(7)},{p(8)})",
            [
                pid,
                name[:160],
                industry[:80],
                page_kind[:32],
                len(blocks),
                json.dumps(blocks, ensure_ascii=False),
                source[:24],
                _now_iso(),
            ],
        )
        return {
            "id": pid,
            "name": name,
            "industry": industry,
            "pageKind": page_kind,
            "blockCount": len(blocks),
            "blocks": blocks,
        }

    def list(self, *, industry: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        # limit 内联而不走占位符：三种后端对 LIMIT 参数化的支持不一致
        # （Neon HTTP 端点尤其挑），int() 已经杜绝注入。同 identity_store.list_users。
        if industry:
            rows = self._x.query(
                f"select * from {TABLE} where industry = {self._x.ph(1)}"
                f" order by created_at desc limit {int(limit)}",
                [industry],
            )
        else:
            rows = self._x.query(
                f"select * from {TABLE} order by created_at desc limit {int(limit)}", []
            )
        return [self._row(r) for r in rows]

    def industries(self) -> List[Dict[str, Any]]:
        """有哪些行业、各几套 —— 组件库那排筛选 chip 直接吃这个。"""
        rows = self._x.query(
            f"select industry, count(*) as n from {TABLE} group by industry order by n desc",
            [],
        )
        # ⚠️ Neon HTTP 端点对 count(*)（int8）返回的是**字符串**，必须显式转
        #（见 app_store._neon_normalize_row 对真库逐类型的实测说明）。
        return [
            {"industry": r.get("industry") or "未分类", "count": int(r.get("n") or 0)}
            for r in rows
        ]

    def delete(self, preset_id: str) -> bool:
        self._x.execute(f"delete from {TABLE} where id = {self._x.ph(1)}", [preset_id])
        return True

    @staticmethod
    def _row(r: Dict[str, Any]) -> Dict[str, Any]:
        raw = r.get("blocks_json")
        # sqlite 存的是文本、PG 的 jsonb 驱动可能已经反序列化过 —— 两种都收，
        # 解不出来时给空数组而不是抛：一条坏记录不该让整个模板库打不开。
        if isinstance(raw, str):
            try:
                blocks = json.loads(raw)
            except Exception:  # noqa: BLE001
                blocks = []
        else:
            blocks = raw or []
        return {
            "id": r.get("id"),
            "name": r.get("name") or "",
            "industry": r.get("industry") or "未分类",
            "pageKind": r.get("page_kind") or "workbench",
            "blockCount": int(r.get("block_count") or 0),
            "blocks": blocks,
            "createdAt": str(r.get("created_at") or ""),
        }


_store: Optional[ComponentPresetStore] = None
_store_lock = threading.Lock()


def get_preset_store() -> ComponentPresetStore:
    """复用 identity_store 已经建好的那条连接通道 —— 不再各自探测一遍后端。

    那段探测里有 TCP 连通性试探（每个地址 connect_timeout 4s），各写一份的话
    冷启动会被重复罚时间，而且两处的降级顺序早晚会漂。
    """
    global _store
    with _store_lock:
        if _store is not None:
            return _store
        from .identity_store import get_identity_store

        ident = get_identity_store()
        _store = ComponentPresetStore(ident._x, is_sqlite=ident._is_sqlite)
        return _store
