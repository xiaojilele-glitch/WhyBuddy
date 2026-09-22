"""
Settings for the migrated SlideRule V5 Python backend.
Modeled after tws-ai-ask-python/config/settings.py but focused on V5 reasoning + stable RAG/LLM for capabilities (report, mcp, skill, evidence, etc.).
Replaces Node's su8 pool, proxy headaches, template fallbacks.
"""

from functools import lru_cache
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings

_PACKAGE_DIR = Path(__file__).resolve().parent.parent  # slide-rule-python/
_REPO_ROOT = _PACKAGE_DIR.parent


class Settings(BaseSettings):
    PORT: int = 9700
    NODE_ENV: str = "development"
    # A separate trusted E2B image owns the fixed browser suite. Empty means
    # blocked; the generated application sandbox never hosts its own examiner.
    E2B_API_KEY: str = ""
    WHYBUDDY_PROJECT_BROWSER_TEMPLATE: str = ""
    WHYBUDDY_PROJECT_BROWSER_TIMEOUT_SECONDS: int = 120

    # DB (reuse cube_pets_office or dedicated). Production credentials must come from .env.
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_NAME: str = "cube_pets_office"
    DB_USER: str = "root"
    DB_PASSWORD: str = ""

    # Vector / RAG (stable evidence source, replacing Node LLM pool for tools/evidence)
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION: str = "knowledge_base"

    # LLM (stable, like original Python; no su8 primary + 6-key pool)
    LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    LLM_API_KEY: Optional[str] = None
    LLM_MODEL: str = "qwen-max"
    LLM_FAST_MODEL: Optional[str] = "qwen-turbo"
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v1"

    # Internal key for SlideRule delegation (from Node).
    #
    # ⚠️ 这个默认值是**出厂密码**：它明文写在仓库里、也写在测试里，等于公开。
    # 它守着 sliderule_full / permissions / tasks 等几十个写接口，生产环境沿用
    # 默认值 = 那些接口对任何能连上端口的人敞开。
    # 所以生产环境沿用默认值**直接拒绝启动**（见下面的 _enforce_non_default_secrets）。
    SLIDE_RULE_INTERNAL_KEY: str = "dev-slide-rule-internal"

    # 允许携带凭据跨站访问本 API 的源。**留空 = 只允许同源**（浏览器默认行为）。
    #
    # 2026-08-04 之前这里没有这个字段，CORS 写死 allow_origins=["*"] +
    # allow_credentials=True。Starlette 对这个组合的处理是**回显任意 Origin**
    # （cors.py:167 `if self.allow_all_origins and self.allow_credentials`），
    # 实测 `curl -H "Origin: https://evil.example"` 拿回的就是
    # `access-control-allow-origin: https://evil.example`。当时没被打穿只是因为
    # 登录 Cookie 带 samesite=lax、浏览器不会在跨站 fetch 上带它——整条防线
    # 押在一个 Cookie 属性上，CORS 这层是零防御。
    #
    # 形状抄 fastapi/full-stack-fastapi-template 的 BACKEND_CORS_ORIGINS
    # （core/config.py:39）：逗号分隔或 JSON 数组，启动时解析成列表。
    BACKEND_CORS_ORIGINS: str = ""

    # Parallel capability batches in the full drive loop (services/v5_full_driver.py).
    # Each selected capability's provider call is independent; default ON overlaps
    # them (execute concurrently, commit sequentially in selection order).
    # Explicit false selects the serial reference path unchanged. Env var of the
    # same name wins at runtime (checked dynamically by _parallel_caps_enabled).
    #
    # persist-before-next-LLM（一轮里 A 落盘再跑 B，崩溃不重烧 A）要求串行：
    # SLIDERULE_PARALLEL_CAPS=false。默认 ON 先把整组 LLM 花完再顺序 commit。
    SLIDERULE_PARALLEL_CAPS: bool = True

    # Durable task (mission) store for the /api/tasks surface (routes/tasks.py).
    # JSON array of [taskId, MissionRecord] entries; override via TASK_STORE_FILE env.
    TASK_STORE_FILE: str = "data/tasks.json"

    # Node-bridge runtime for skill.invoke / mcp.call (strangler migration).
    # Python owns the runtime boundary; execution is bridged to Node's existing
    # /api/skills/:id/execute and /api/mcp/nodes/execute until native adapters land.
    NODE_BRIDGE_RUNTIME_ENABLED: bool = True
    NODE_BRIDGE_BASE_URL: str = "http://localhost:3001"

    # Real vector RAG (embeddings + cosine index). Needs LLM_API_KEY for the
    # OpenAI-compatible /embeddings endpoint; without it retrieval falls back
    # to the keyword baseline with honest provenance.
    RAG_VECTOR_ENABLED: bool = True
    RAG_VECTOR_INDEX_PATH: str = "data/rag-vector-index.json"

    # 生成应用存储 / App Store（推演出来的应用「设计层」持久化 → 组建库地基）。
    # 填了连接串（任意 SQLAlchemy URL：Neon/自建 Postgres 用 postgresql://…，
    # 也接受 sqlite:///data/apps.db 这种本地库）就落库；不填 fail-open 回退
    # 本地 JSON 文件（APP_STORE_FILE），行为与"没有 DB"时完全一致。跟账号功能
    # 的 MySQL DATABASE_URL（DB_* 那套）是两个独立子系统，互不影响。
    APP_STORE_DATABASE_URL: Optional[str] = None
    # 受限网络专用：走自定义 HTTPS SQL API（例如本仓库的 /db-api）。
    # 只在外部环境没有原生 Postgres 协议时使用；留空则不用。
    APP_STORE_HTTP_API_URL: str = ""
    # 自定义 HTTPS SQL API 的鉴权 token（通常是 Bearer token）。
    APP_STORE_HTTP_API_KEY: str = ""
    # 本地库兜底（2026-07-28）：远端连不上时先落本地 SQLite，再不行才回 JSON。
    # SQLite 比 JSON 强在能查询/能索引/写入是事务性的（JSON 是整文件重写）。
    # 置空字符串则跳过这一级，直接 JSON——受限文件系统/只读容器里用得上。
    APP_STORE_LOCAL_SQLITE: str = "sqlite:///data/sliderule-apps.db"
    APP_STORE_FILE: str = "data/sliderule-generated-apps.json"

    # AgentLoop worker bridge (108): builds commands for existing Node queue runner.
    # Node remains execution owner; Python owns command construction + receipts.
    # Safe defaults; do not assume node present in dry-run.
    AGENT_LOOP_ROOT: str = "agent-loop"
    AGENT_LOOP_RUN_QUEUE: str = "scripts/run-queue.mjs"
    AGENT_LOOP_LOOP_SCRIPT: str = "src/loop.js"
    AGENT_LOOP_NODE_COMMAND: str = "node"
    AGENT_LOOP_DEFAULT_TIMEOUT_MS: int = 1800000
    AGENT_LOOP_BRIDGE_DRY_RUN: bool = False

    @property
    def DATABASE_URL(self) -> str:
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"

    @property
    def is_development(self) -> bool:
        return self.NODE_ENV == "development"

    @property
    def is_production(self) -> bool:
        """判据跟 services/auth_tokens._is_production 保持一致（NODE_ENV / APP_ENV）。"""
        import os

        env = (self.NODE_ENV or os.getenv("APP_ENV") or "").strip().lower()
        return env in ("production", "prod")

    @property
    def cors_origins(self) -> list[str]:
        """解析后的跨站白名单。**空列表 = 不装 CORS 中间件 = 只允许同源。**

        接受逗号分隔（`https://a.com,https://b.com`）或 JSON 数组，
        形状同 full-stack-fastapi-template 的 `parse_cors`。
        """
        raw = (self.BACKEND_CORS_ORIGINS or "").strip()
        if not raw:
            return []
        if raw.startswith("["):
            import json

            try:
                return [str(x).rstrip("/") for x in json.loads(raw) if str(x).strip()]
            except Exception:  # noqa: BLE001 — 配歪了按"没配"处理，不放开
                return []
        return [p.strip().rstrip("/") for p in raw.split(",") if p.strip()]

    def _check_default_secret(self, name: str, value: str, default: str) -> None:
        """出厂密码在生产环境**拒绝启动**，开发环境只警告。

        逐行照 fastapi/full-stack-fastapi-template `core/config.py:96`
        的 `_check_default_secret`——包括"local 只 warn、其余 raise"这个分档。
        本地开发要能一把跑起来，上线必须换掉，两个需求靠环境区分而不是靠自觉。
        """
        if value != default:
            return
        message = (
            f"{name} 仍是出厂默认值（{default!r}）。它明文写在仓库和测试里，"
            f"等于公开——生产环境必须改掉。"
        )
        if self.is_production:
            raise ValueError(message)
        import warnings

        warnings.warn(message, stacklevel=1)

    def _enforce_non_default_secrets(self) -> "Settings":
        self._check_default_secret(
            "SLIDE_RULE_INTERNAL_KEY", self.SLIDE_RULE_INTERNAL_KEY, "dev-slide-rule-internal"
        )
        return self

    class Config:
        # 与 CWD 无关的确定性 env 链（真实事故：uvicorn 以 slide-rule-python 为
        # CWD 启动时，相对路径 ".env" 找不到根目录配置，静默落回 dashscope 默认，
        # 新颖意图 LLM 生成拿不到 key → 发布闭环 fail-closed 0/6）。
        # 元组靠后的文件优先级更高：根目录 .env 赢冲突（与 dev 脚本语义一致）；
        # os.environ 永远最高优先（pydantic-settings 固有规则）。
        env_file = (str(_PACKAGE_DIR / ".env"), str(_REPO_ROOT / ".env"))
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    # 出厂密码检查放在这里而不是 pydantic 的 model_validator：这个模块被大量
    # 测试直接 import，validator 会在**每次**构造 Settings 时跑，而测试里造
    # Settings 是常态。放在缓存过的工厂里，每个进程只跑一次。
    return Settings()._enforce_non_default_secrets()

settings = get_settings()
