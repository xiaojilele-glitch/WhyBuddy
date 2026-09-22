"""身份存储的独立回归测试。"""

from __future__ import annotations


def test_sql_executor_uses_psycopg_v3_for_plain_postgresql_urls(monkeypatch):
    """裸 postgresql:// 连接串不能让 SQLAlchemy 回退去找 psycopg2。"""
    from services import identity_store as ident
    from types import SimpleNamespace

    made: dict[str, object] = {}

    class FakeEngine:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):  # pragma: no cover - 本用例只测初始化 URL
            raise AssertionError("not used")

        def begin(self):  # pragma: no cover
            raise AssertionError("not used")

    def fake_create_engine(url, connect_args=None, **kwargs):
        made["url"] = url
        made["connect_args"] = connect_args or {}
        made["kwargs"] = kwargs
        return FakeEngine()

    monkeypatch.setattr("sqlalchemy.create_engine", fake_create_engine)

    x = ident._SqlExecutor("postgresql://u:p@local-postgres:5432/appdb?sslmode=require")

    assert made["url"].startswith("postgresql+psycopg://")
    assert x.is_sqlite is False


def test_first_completed_registration_becomes_superuser(tmp_path, monkeypatch):
    """空身份库里的第一个注册用户自动提升为超管。"""
    from config.settings import settings
    from services import auth_service, identity_store as ident

    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'identity.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "s" * 48)
    ident.reset_identity_cache()

    try:
        started = auth_service.start_registration("first@example.com", "correct-horse-battery")
        assert started["ok"] is True
        result = auth_service.complete_registration(
            "first@example.com",
            "correct-horse-battery",
            str(started["devCode"]),
        )
        assert result["ok"] is True
        assert result["isFirstSuperuser"] is True
        assert result["user"]["isSuperuser"] is True
    finally:
        ident.reset_identity_cache()
