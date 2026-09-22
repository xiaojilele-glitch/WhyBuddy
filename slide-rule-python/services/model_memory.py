# -*- coding: utf-8 -*-
"""模型自己攒的记忆：它写、它查，跨会话活着。

抄的标准答案：grok-build `xai-grok-memory`（`MemoryScope` / `MemoryStorage`）
以及它的两件模型工具（`ToolKind::MemorySearch` / `MemoryGet`）。

──────────────────────────────────────────────────────────────────────────
## 跟产品宪章**不是一回事**，两份不许合并

    产品宪章 services/product_charter.py
        **用户自己写的**行业约束（「我们公司的表单一律要有审批流」）
        长期不变、opt-in 才进推演、模型只读

    这一份
        **模型自己攒的**经验（「这个用户上次说过不要蓝色」）
        它自己写、自己查、随时可能过时

合并了会出现「模型往宪章里塞一条自己编的规矩，下一场当成用户定的约束执行」。
判据 `test_记忆和宪章是两张表` 钉着。

──────────────────────────────────────────────────────────────────────────
## 没抄的那一大半，以及为什么

grok 的 memory 是 17 个 rs：markdown 文件、embedding、sqlite-vec 向量索引、
MMR 重排、查询扩展、后台 dream 整理、文件 watcher。

**这里一样都没做，是有意的**：

· **不做向量检索。** 一个用户的记忆是几十条，不是几万条——几十条上做
  关键词匹配和做向量检索的召回差别可以忽略，而向量索引是一整套我们今天
  没有、也没法在一夜里验完的基础设施。哪天真到了几千条再说。
· **不做后台整理（dream）。** 那需要一个我们没有的后台作业框架。
· **不做文件形态。** grok 的记忆是 `~/.grok/memory/*.md`，人可以直接编辑——
  那是给工程师的形态。面团的用户不开终端。

存储照抄 `product_charter.CharterStore` 的模式（同一条执行器、自己的表、
persist 失败有进程内回落），**不共用它那张表**。
"""

from __future__ import annotations

import json
import threading
from typing import Any, Dict, List, Optional, Tuple

# ⚠ 顶层 import，不学 product_charter 把它藏进函数体：那条边在架构基线里，
#   新代码不许再加（`arch_graph --check` 会红——「函数体 import 新增了 1 条」）。
#   身份存储只被用来借它那条执行器，没有反向依赖，顶层引不成环。
from .identity_store import get_identity_store

TABLE = "sliderule_model_memory"

_DDL_PG = f"""
create table if not exists {TABLE} (
    scope varchar(16) not null,
    scope_id varchar(80) not null,
    notes_json text,
    updated_at timestamp,
    primary key (scope, scope_id)
)
"""

_DDL_SQLITE = _DDL_PG

#: 一个 scope 最多留几条。超了从最旧的开始丢。
#:
#: 200 是拍的，但拍得有理由：这份记忆每轮都要能被检索、检索结果要进提示词。
#: 几百条上做关键词匹配还是毫秒级；上万条就该换索引了，而换索引是另一件事
#: （见模块头注为什么这一版不做向量检索）。
MAX_NOTES = 200

#: 单条上限。抄 grok 的 chunk 思路——一条记忆是一句话，不是一篇文档。
#: 超了截断而不是拒收：模型写长了是常事，为此丢掉整条不划算。
MAX_NOTE_CHARS = 300

#: 一次检索最多回几条。回太多会把提示词顶穿（`bound_tool_result` 那条同源）。
MAX_RECALL = 8

_store_lock = threading.Lock()
_store: Any = None
_store_ident: Any = None
#: persist 失败时的进程内回落。不是第二套库——只是 fail-open 的缓冲。
#: （照抄 product_charter._MEM 那条注释的用意。）
_MEM: Dict[Tuple[str, str], List[Dict[str, str]]] = {}


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _key(scope: str, scope_id: str) -> Tuple[str, str]:
    return (str(scope or "user"), str(scope_id or "")[:80])


class MemoryStore:
    """跟 CharterStore 同一条执行器，不另开数据库。**自己的表**。"""

    def __init__(self, executor: Any, *, is_sqlite: bool) -> None:
        self._x = executor
        self._x.execute(_DDL_SQLITE if is_sqlite else _DDL_PG)

    def load(self, *, scope: str, scope_id: str) -> List[Dict[str, str]]:
        p = self._x.ph
        rows = self._x.query(
            f"select notes_json from {TABLE} where scope = {p(1)} and scope_id = {p(2)}",
            [scope, scope_id[:80]],
        )
        if not rows:
            return []
        raw = rows[0].get("notes_json")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                return []
        return normalize(raw)

    def save(self, *, scope: str, scope_id: str, notes: List[Dict[str, str]]) -> None:
        p = self._x.ph
        # One statement keeps the previous durable value intact if the write
        # fails midway.  DELETE then INSERT used to commit twice via the
        # executor, so a transient INSERT error silently erased memory.
        self._x.execute(
            f"insert into {TABLE} (scope, scope_id, notes_json, updated_at)"
            f" values ({p(1)},{p(2)},{p(3)},{p(4)})"
            f" on conflict (scope, scope_id) do update set"
            f" notes_json = excluded.notes_json, updated_at = excluded.updated_at",
            [scope, scope_id[:80], json.dumps(notes, ensure_ascii=False), _now_iso()],
        )


def get_memory_store() -> Optional[MemoryStore]:
    global _store, _store_ident
    try:
        ident = get_identity_store()
    except Exception:  # noqa: BLE001 — persist fail-open
        return None
    with _store_lock:
        if _store is not None and _store_ident is ident:
            return _store
        try:
            _store = MemoryStore(ident._x, is_sqlite=ident._is_sqlite)
            _store_ident = ident
            return _store
        except Exception:  # noqa: BLE001
            _store = None
            _store_ident = None
            return None


def reset_memory_cache() -> None:
    """测试用。连同进程内回落一起清。"""
    global _store, _store_ident
    with _store_lock:
        _store = None
        _store_ident = None
    _MEM.clear()


def normalize(raw: Any) -> List[Dict[str, str]]:
    """落库的东西读回来的规范形状。脏数据一律丢，不抛。"""
    out: List[Dict[str, str]] = []
    for row in raw or []:
        if isinstance(row, str):
            row = {"text": row}
        if not isinstance(row, dict):
            continue
        text = str(row.get("text") or "").strip()[:MAX_NOTE_CHARS]
        if not text:
            continue
        out.append({"text": text, "at": str(row.get("at") or "")})
    return out


def load_notes(*, scope: str = "user", scope_id: str) -> List[Dict[str, str]]:
    if not scope_id:
        return []
    k = _key(scope, scope_id)
    store = get_memory_store()
    if store is not None:
        try:
            notes = store.load(scope=k[0], scope_id=k[1])
            _MEM[k] = notes
            return notes
        except Exception:  # noqa: BLE001 — 读不到就用回落，不许把主链路带崩
            pass
    return list(_MEM.get(k) or [])


def remember(*, scope: str = "user", scope_id: str, text: str) -> Tuple[bool, str]:
    """记一条。返回 (记没记, 说给模型的一句话)。

    重复的不记第二遍——模型每轮都想"确认一下"是常事，不去重会把同一句
    攒成几十条，然后把检索结果全占满。
    """
    note = str(text or "").strip()[:MAX_NOTE_CHARS]
    if not note:
        return False, "空的记不了。"
    if not scope_id:
        return False, "这一发没有归属，记不了。"
    notes = load_notes(scope=scope, scope_id=scope_id)
    if any(row["text"] == note for row in notes):
        return False, "这条已经记过了。"
    notes.append({"text": note, "at": _now_iso()})
    # 超了从**最旧的**开始丢。新的更可能还成立。
    if len(notes) > MAX_NOTES:
        notes = notes[-MAX_NOTES:]
    k = _key(scope, scope_id)
    _MEM[k] = notes
    store = get_memory_store()
    if store is not None:
        try:
            store.save(scope=k[0], scope_id=k[1], notes=notes)
        except Exception:  # noqa: BLE001 — persist fail-open，进程内那份还在
            pass
    return True, "记下了。"


def recall(
    *, scope: str = "user", scope_id: str, query: str = "", limit: int = MAX_RECALL
) -> List[Dict[str, str]]:
    """按关键词找。空查询 = 拿最近几条。

    ⚠ 关键词匹配，**不是向量检索**（模块头注写了为什么）。
      打分规则简单到能一眼看懂：命中的词越多越靠前，同分按新的在前。
      看不懂的排序在这种场合比排得差更糟——排差了能改，看不懂没法查。
    """
    notes = load_notes(scope=scope, scope_id=scope_id)
    if not notes:
        return []
    n = max(1, min(int(limit or MAX_RECALL), MAX_RECALL))
    q = str(query or "").strip()
    if not q:
        return list(reversed(notes))[:n]
    terms = [t for t in _terms(q) if t]
    if not terms:
        return list(reversed(notes))[:n]
    scored = []
    for i, row in enumerate(notes):
        text = row["text"]
        hits = sum(1 for t in terms if t in text)
        if hits:
            scored.append((hits, i, row))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return [row for _, _, row in scored[:n]]


def _terms(query: str) -> List[str]:
    """切词。中英混排：英文按空白切，中文按 2 字滑窗。

    ⚠ 别引分词库。这份记忆是几十条，2 字滑窗的召回已经够用；
      引一个库要连它的模型文件一起进镜像，为几十条不划算。
    """
    q = str(query or "").strip()
    out: List[str] = [w for w in q.split() if len(w) >= 2]
    cjk = "".join(ch for ch in q if "一" <= ch <= "鿿")
    out.extend(cjk[i : i + 2] for i in range(max(0, len(cjk) - 1)))
    return list(dict.fromkeys(out))


def summarize(notes: List[Dict[str, str]]) -> str:
    """喂回模型的那一段。"""
    if not notes:
        return "没有相关的记忆。"
    return "\n".join(f"· {row['text']}" for row in notes)
