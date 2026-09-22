"""把话题档写进远端库。

## 2026-08-05：从 Neon 改成走应用自己那条通道

原来这里自己拼 Neon 的 SQL-over-HTTP 端点，`endpoint_for` 还硬卡
`*.neon.tech`。Neon 因为流量配额打满停用之后，这条链整个断了——表也
跟着没了。

现在不再自己接线，直接复用 `services.app_store` 里的连接选择：网关
（APP_STORE_HTTP_API_URL）优先，其次 TCP 连接串。好处不只是少写代码：
占位符方言转换、鉴权头、行数上限、错误映射都在那一处，网关将来改了
这个脚本不用跟着改——本项目已经在"同一份 SQL 抄两遍"上吃过亏。

凭据只走请求头，不进 URL、不进日志。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# 列序绑定 INSERT 的占位符序，改字段只改这一处
COLUMNS = (
    "id", "topic_id", "url", "title", "category_id", "category_name", "tags",
    "author_username", "author_name", "created_at", "last_posted_at",
    "posts_count", "reply_count", "views", "like_count", "participant_count",
    "word_count", "has_accepted_answer", "body_text", "body_html",
    "images", "links", "replies", "fetched_at",
)
JSONB_COLS = {"tags", "images", "links", "replies"}
INT_COLS = {"topic_id", "category_id", "posts_count", "reply_count", "views",
            "like_count", "participant_count", "word_count"}

DDL = """
create table if not exists forum_topic (
    id                  varchar(64) primary key,
    topic_id            integer not null,
    url                 text,
    title               text,
    category_id         integer,
    category_name       varchar(120),
    tags                jsonb,
    author_username     varchar(120),
    author_name         varchar(120),
    created_at          timestamptz,
    last_posted_at      timestamptz,
    posts_count         integer,
    reply_count         integer,
    views               integer,
    like_count          integer,
    participant_count   integer,
    word_count          integer,
    has_accepted_answer boolean,
    body_text           text,
    body_html           text,
    images              jsonb,
    links               jsonb,
    replies             jsonb,
    fetched_at          timestamptz
)
"""


# ── 能力圈分档（2026-08-05）────────────────────────────────────
#
# 这四列跟上面那些**性质不一样**：上面是从论坛抓来的事实，这里是一次判断的
# 结果——判断会随着判定标准（rubric）和模型换代而变。所以不只存结论，还存
# 「哪个模型、什么时候判的」，否则过两个月看到一个 A 没人知道该不该信。
#
# 刻意不放进 COLUMNS：`upsert` 的 `do update set` 是按 COLUMNS 拼的，分档列
# 不在里面 → **重抓一遍话题不会把分档冲掉**。抓取和判断本来就该各走各的。
FIT_COLUMNS_DDL = (
    "alter table forum_topic add column if not exists fit_grade  varchar(1)",
    "alter table forum_topic add column if not exists fit_reason varchar(60)",
    "alter table forum_topic add column if not exists fit_model   varchar(60)",
    "alter table forum_topic add column if not exists fit_at      timestamptz",
    # 正文复核。标题档和正文档必须分列：2026-08-21 标题-only 把「删帖删帖」
    # 「111111你好」也打成 A，覆盖会把事故证据一起抹掉。
    "alter table forum_topic add column if not exists fit_body_grade  varchar(1)",
    "alter table forum_topic add column if not exists fit_body_reason varchar(60)",
    "alter table forum_topic add column if not exists fit_body_model  varchar(60)",
    "alter table forum_topic add column if not exists fit_body_at     timestamptz",
    "alter table forum_topic add column if not exists fit_device      varchar(16)",
    "alter table forum_topic add column if not exists fit_device_why  varchar(60)",
    "alter table forum_topic add column if not exists fit_device_model varchar(60)",
    "alter table forum_topic add column if not exists fit_device_at   timestamptz",
)

#: 分档含义。判定基准是 SlideRule 的能力圈——它产出五系统模型
#: （数据实体 / 角色权限 / 工作流 / 页面 / AI 能力），只擅长
#: 「表单 + 台账 + 角色 + 流转」这一类业务系统。
FIT_GRADES = {
    "A": "正中靶心：本质是业务系统，有实体、有角色、有申请/审批/流转",
    "B": "半个：有结构化数据和管理界面，但没有多角色流转",
    "C": "圈外：游戏/3D/硬件固件/音视频/图像生成，没有实体+角色这个结构",
    "U": "未判定",
}


def _load_env() -> None:
    """脚本单独跑时不经过 app 启动，得自己把 .env 读进来。"""
    try:
        from dotenv import load_dotenv

        load_dotenv(REPO / ".env")
    except ImportError:  # 没装 python-dotenv 就只认真实环境变量
        pass


class Store:
    """话题档的库句柄。通道由 app_store 统一决定，这里不自己判断。"""

    def __init__(self) -> None:
        _load_env()
        from config.settings import settings
        from services.app_store import HttpSqlGateway, http_api_credentials

        api_url, api_key = http_api_credentials()
        if api_url and api_key:
            self._gateway = HttpSqlGateway(api_url, api_key, timeout_s=60.0)
            self._engine = None
            print(f"通道：HTTPS SQL 网关 {self._gateway.endpoint}")
            return

        url = (getattr(settings, "APP_STORE_DATABASE_URL", "") or "").strip()
        if not url:
            raise SystemExit(
                "既没配 APP_STORE_HTTP_API_URL/_KEY，也没配 APP_STORE_DATABASE_URL"
            )
        from sqlalchemy import create_engine
        from sqlalchemy.pool import NullPool

        from services.app_store import _sql_engine_config

        connect_args, kwargs = _sql_engine_config(url, NullPool)
        self._gateway = None
        self._engine = create_engine(url, connect_args=connect_args, **kwargs)
        print("通道：TCP 直连")

    def q(self, sql: str, params: Optional[list[Any]] = None) -> list[dict[str, Any]]:
        if self._gateway is not None:
            # `$n` → `%s` 的方言转换在网关那一层，这里的 SQL 保持 Postgres 写法
            return self._gateway.query(sql, params)
        from sqlalchemy import text

        # SQLAlchemy 走具名参数，把 $n 换成 :pn
        bound = sql
        for i in range(len(params or []), 0, -1):
            bound = bound.replace(f"${i}", f":p{i}")
        binds = {f"p{i + 1}": v for i, v in enumerate(params or [])}
        with self._engine.begin() as conn:
            result = conn.execute(text(bound), binds)
            # DDL / INSERT 没有结果集，取 .mappings() 会抛 ResourceClosedError
            if not result.returns_rows:
                return []
            return [dict(r) for r in result.mappings().all()]

    def ensure_table(self) -> None:
        self.q(DDL)
        for col in ("topic_id", "category_id", "created_at", "views"):
            self.q(f"create index if not exists ix_forum_topic_{col} on forum_topic ({col})")
        for ddl in FIT_COLUMNS_DDL:
            self.q(ddl)
        self.q("create index if not exists ix_forum_topic_fit_grade on forum_topic (fit_grade)")
        self.q(
            "create index if not exists ix_forum_topic_fit_body_grade "
            "on forum_topic (fit_body_grade)"
        )
        self.q("create index if not exists ix_forum_topic_fit_device on forum_topic (fit_device)")

    @staticmethod
    def _row_params(rec: dict[str, Any]) -> list[Any]:
        params: list[Any] = []
        for col in COLUMNS:
            val = rec.get(col)
            if col in JSONB_COLS:
                val = json.dumps(val if val is not None else [], ensure_ascii=False)
            elif col in INT_COLS:
                val = None if val is None else int(val)
            elif col == "has_accepted_answer":
                val = bool(val)
            params.append(val)
        return params

    def upsert(self, rec: dict[str, Any]) -> None:
        self.upsert_many([rec])

    def upsert_many(self, recs: list[dict[str, Any]]) -> None:
        """一条语句写多行。

        2000 条逐行插入就是 2000 次 HTTPS 往返；按 40ms 一次算是一分多钟纯等
        网络。合并成多行 VALUES 之后往返数降一到两个量级。

        ⚠ 批的大小必须**按字节**卡，不能只按条数：话题正文差距极大（实测中位
        39KB、最大 260KB），而网关的 DB_API_MAX_BODY_BYTES 默认 1MB。按条数
        分批的话，几条长文凑一起就会撞 413，而且只在长文多的那一批上偶发。
        """
        if not recs:
            return
        updates = ", ".join(f"{c} = excluded.{c}" for c in COLUMNS if c != "id")
        n_cols = len(COLUMNS)
        params: list[Any] = []
        groups: list[str] = []
        for rec in recs:
            row = self._row_params(rec)
            base = len(params)
            groups.append("(" + ", ".join(
                f"${base + i + 1}::jsonb" if c in JSONB_COLS else f"${base + i + 1}"
                for i, c in enumerate(COLUMNS)
            ) + ")")
            params.extend(row)
        assert len(params) == n_cols * len(recs)
        self.q(
            f"insert into forum_topic ({', '.join(COLUMNS)}) values {', '.join(groups)} "
            f"on conflict (id) do update set {updates}",
            params,
        )

    def count(self) -> int:
        # ⚠ count(*) 是 int8。Neon 的 HTTP 端点对 bigint 返回**字符串**，新网关
        # 走 psycopg 返回真 int——两边行为不一样。显式 ::int 之后两边都对，
        # 外加一层 int() 兜底，不赌任何一边。
        return int(self.q("select count(*)::int as n from forum_topic")[0]["n"])


#: 单批请求体的字节预算。网关默认 DB_API_MAX_BODY_BYTES = 1MB，留三成余量给
#: SQL 文本本身和 JSON 转义膨胀（中文在 JSON 里会变成 \uXXXX，最坏 6 倍）。
_BATCH_BYTE_BUDGET = 700_000
#: 再加一道条数上限。字节没到顶但行数太多时，一条语句的占位符会多到离谱
#: （24 列 × 200 行 = 4800 个），解析开销反而上来了。
_BATCH_MAX_ROWS = 100


def _batched(recs: list[dict[str, Any]]) -> "list[list[dict[str, Any]]]":
    """按字节预算 + 条数上限切批。单条自己就超预算时独占一批（总得试一次）。"""
    out: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    cur_bytes = 0
    for rec in recs:
        size = len(json.dumps(rec, ensure_ascii=False).encode("utf-8"))
        if cur and (cur_bytes + size > _BATCH_BYTE_BUDGET or len(cur) >= _BATCH_MAX_ROWS):
            out.append(cur)
            cur, cur_bytes = [], 0
        cur.append(rec)
        cur_bytes += size
    if cur:
        out.append(cur)
    return out


def main() -> None:
    src = Path(sys.argv[1])
    db = Store()
    db.ensure_table()
    before = db.count()
    print(f"表就绪，当前 {before} 条")

    recs: list[dict[str, Any]] = []
    skipped = 0
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            recs.append(json.loads(line))
        except json.JSONDecodeError:
            # 抓取还在往同一个文件追加时，最后一行可能只写了一半。跳过而不是
            # 崩掉——这个脚本要能对着一个正在增长的 JSONL 跑，随时落库兜底。
            skipped += 1

    batches = _batched(recs)
    print(f"读到 {len(recs)} 条，切成 {len(batches)} 批")
    ok = fail = 0
    started = time.monotonic()
    for n, batch in enumerate(batches, 1):
        try:
            db.upsert_many(batch)
            ok += len(batch)
        except Exception as exc:  # noqa: BLE001 — 整批失败时逐条重试，别连坐
            print(f"  批 {n} 整批失败，改逐条重试：{str(exc)[:160]}", flush=True)
            for rec in batch:
                try:
                    db.upsert(rec)
                    ok += 1
                except Exception as one_exc:  # noqa: BLE001
                    fail += 1
                    print(f"    ✗ {rec.get('id')}: {str(one_exc)[:160]}", flush=True)
        if n % 5 == 0 or n == len(batches):
            print(f"  [{n}/{len(batches)}] 已写 {ok} 条", flush=True)

    dur = time.monotonic() - started
    tail = f"，跳过半行 {skipped}" if skipped else ""
    print(f"写入完成：成功 {ok}，失败 {fail}{tail}；用时 {dur:.0f}s；"
          f"表内 {before} → {db.count()} 条")


if __name__ == "__main__":
    main()
