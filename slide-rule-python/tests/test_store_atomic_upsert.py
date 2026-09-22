import sqlite3

from services.model_memory import MemoryStore
from services.product_charter import CharterStore


class SqliteExecutor:
    is_sqlite = True

    def __init__(self):
        self.db = sqlite3.connect(":memory:")

    def ph(self, n):
        return "?"

    def execute(self, sql, params=None):
        self.db.execute(sql, params or [])
        self.db.commit()

    def query(self, sql, params):
        cur = self.db.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def test_model_memory_replaces_existing_row_atomically():
    x = SqliteExecutor()
    store = MemoryStore(x, is_sqlite=True)
    store.save(scope="user", scope_id="u1", notes=[{"text": "old", "at": ""}])
    store.save(scope="user", scope_id="u1", notes=[{"text": "new", "at": ""}])
    assert store.load(scope="user", scope_id="u1")[0]["text"] == "new"
    assert x.db.execute("select count(*) from sliderule_model_memory").fetchone()[0] == 1


def test_product_charter_replaces_existing_row_atomically():
    x = SqliteExecutor()
    store = CharterStore(x, is_sqlite=True)
    store.upsert(scope="user", scope_id="u1", charter={"industry": "old"}, reuse_next=False)
    store.upsert(scope="user", scope_id="u1", charter={"industry": "new"}, reuse_next=True)
    loaded = store.load(scope="user", scope_id="u1")
    assert loaded["charter"]["industry"] == "new"
    assert loaded["reuse_next"] is True
    assert x.db.execute("select count(*) from sliderule_product_charter").fetchone()[0] == 1
