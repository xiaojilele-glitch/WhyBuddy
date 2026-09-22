"""给应用记录加归属与可见性（2026-08-02）。

    cd slide-rule-python
    .venv/bin/python scripts/migrate_app_ownership.py            # 只看不改（默认）
    .venv/bin/python scripts/migrate_app_ownership.py --apply    # 真改

**默认只看不写**，要加 `--apply` 才动手。这是线上库，`ALTER TABLE` 在 Postgres 上
要拿 ACCESS EXCLUSIVE 锁——虽然加列（带默认值、不重写整表）很快，但仍然要在知道
影响面之后再做。

## 这次改什么

    generated_app  加两列：
        owner_id    varchar(64)  可空 —— 空 = 无主的存量应用
        visibility  varchar(16)  默认 'public'

    新建 generated_app_grant（显式授权）：
        app_id / user_id / access(int) / created_at

## 两个刻意的取舍

**① 存量应用的 owner_id 留空，不认领给任何人。**
   猜错归属比没有归属糟得多——认领错了等于把 A 的应用送给 B。空值的语义在
   app_access 里已经定义好：**可读、不可写**（超管除外），迁移期由超管代为处理。

**② 存量应用的 visibility 设成 public，与现状一致。**
   现在没有权限，所有人都能看见所有应用。设成 private 会让应用中心在部署那一刻
   突然空掉——那是比"暂时还没收紧"更糟的体验。收紧应该是用户自己一条条来做的决定。

## 回滚

加列是可逆的，但**回滚会丢掉这两列里已经产生的数据**：

    alter table generated_app drop column if exists owner_id;
    alter table generated_app drop column if exists visibility;
    drop table if exists generated_app_grant;

刻意不写成脚本——破坏性操作应当由人手敲。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PY_DIR))

# 加列语句。分开写而不是一条多列 ALTER：某一列已经存在时不至于整条失败。
COLUMNS = (
    ("owner_id", "alter table generated_app add column if not exists owner_id varchar(64)"),
    (
        "visibility",
        "alter table generated_app add column if not exists visibility varchar(16) default 'public'",
    ),
)

INDEXES = (
    "create index if not exists ix_generated_app_owner on generated_app (owner_id)",
    "create index if not exists ix_generated_app_visibility on generated_app (visibility)",
)

GRANT_TABLE = """
create table if not exists generated_app_grant (
    app_id varchar(36) not null,
    user_id varchar(64) not null,
    access integer not null,
    created_at timestamptz,
    primary key (app_id, user_id)
)
"""

BACKFILL = "update generated_app set visibility = 'public' where visibility is null"


def _load_env() -> None:
    import os

    for path in (_PY_DIR.parent / ".env", _PY_DIR / ".env"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的执行（默认只看不改）")
    args = ap.parse_args()

    _load_env()
    from config.settings import settings
    from services.app_store import neon_http_endpoint, prefer_neon_http

    url = (settings.APP_STORE_DATABASE_URL or "").strip()
    if not url:
        print("没有配 APP_STORE_DATABASE_URL —— 本地 JSON/SQLite 后端不需要这次迁移")
        return 0

    host = url.split("@")[-1].split("/")[0]
    endpoint = neon_http_endpoint(url)
    channel = "SQL over HTTP" if (prefer_neon_http() and endpoint) else "TCP"
    print(f"目标库: {host}")
    print(f"通道:   {channel}")
    print(f"模式:   {'APPLY（会真改）' if args.apply else 'DRY-RUN（只看不改）'}")
    print()

    q = _make_query(url, endpoint, prefer_neon_http())

    # ── 现状 ────────────────────────────────────────────
    existing = {
        r["column_name"]
        for r in q(
            "select column_name from information_schema.columns "
            "where table_name = 'generated_app'"
        )
    }
    total = int(q("select count(*) as n from generated_app")[0]["n"])
    print(f"generated_app 现有 {len(existing)} 列、{total} 条记录")

    has_grant = bool(
        q(
            "select 1 as x from information_schema.tables "
            "where table_name = 'generated_app_grant'"
        )
    )

    # ── 计划 ────────────────────────────────────────────
    plan: list[tuple[str, str]] = []
    for name, sql in COLUMNS:
        if name in existing:
            print(f"  · {name:<12} 已存在，跳过")
        else:
            plan.append((f"加列 {name}", sql))
    if has_grant:
        print("  · generated_app_grant 已存在，跳过")
    else:
        plan.append(("建表 generated_app_grant", GRANT_TABLE))
    for sql in INDEXES:
        plan.append(("建索引", sql))
    plan.append(("回填 visibility", BACKFILL))

    print(f"\n待执行 {len(plan)} 步：")
    for label, sql in plan:
        print(f"  [{label}] {' '.join(sql.split())[:110]}")

    # ── 影响面 ──────────────────────────────────────────
    print("\n影响面：")
    print(f"  · {total} 条应用记录的 owner_id 会是 **空**（不认领给任何人）")
    print("      语义：可读、不可写（超管除外）—— 猜错归属比没有归属糟得多")
    print(f"  · {total} 条记录的 visibility 会是 'public'（与现状一致，应用中心不会突然空掉）")
    if "owner_id" not in existing:
        print("  · ALTER TABLE 要拿 ACCESS EXCLUSIVE 锁。加列带默认值不重写整表，")
        print("      Postgres 11+ 是毫秒级；但如果此刻有长事务在跑会排队等待。")

    # 顺带看看有多少条记录带 session_id（未来认领归属时的线索）
    with_sess = int(
        q("select count(*) as n from generated_app where session_id is not null")[0]["n"]
    )
    print(f"  · 其中 {with_sess} 条带 session_id，将来可据此认领归属")

    if not args.apply:
        print("\n（DRY-RUN，什么都没做。要真改加 --apply）")
        return 0

    print("\n开始执行…")
    for label, sql in plan:
        q(sql)
        print(f"  ✅ {label}")

    after = {
        r["column_name"]
        for r in q(
            "select column_name from information_schema.columns "
            "where table_name = 'generated_app'"
        )
    }
    print(f"\n完成。generated_app 现有 {len(after)} 列（新增 {len(after) - len(existing)}）")
    sample = q("select visibility, count(*) as n from generated_app group by visibility")
    for row in sample:
        print(f"  visibility={row['visibility']}: {row['n']} 条")
    return 0


def _make_query(url: str, endpoint, prefer_http: bool):
    """返回一个 `sql -> list[dict]` 的执行器，通道与运行时保持一致。"""
    if prefer_http and endpoint:
        import httpx

        from services.app_store import _neon_http_error

        client = httpx.Client(
            timeout=30,
            headers={"Neon-Connection-String": url, "Content-Type": "application/json"},
        )

        def q(sql: str):
            resp = client.post(endpoint, json={"query": sql, "params": []})
            if resp.status_code >= 400:
                raise _neon_http_error(resp)
            return resp.json().get("rows") or []

        return q

    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    from services.app_store import _sql_engine_config

    connect_args, kwargs = _sql_engine_config(url, NullPool)
    engine = create_engine(url, connect_args=connect_args, **kwargs)

    def q(sql: str):
        with engine.begin() as conn:
            result = conn.execute(text(sql))
            if result.returns_rows:
                return [dict(r) for r in result.mappings().all()]
            return []

    return q


if __name__ == "__main__":
    raise SystemExit(main())
