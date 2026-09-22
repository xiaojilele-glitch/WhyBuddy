"""Provider contract for disposable project workspaces.

The provider owns remote execution details; project_store owns source and
leases. Keeping this protocol free of HTTP routes makes it usable by workers
and by deterministic contract tests.
"""

from dataclasses import dataclass, field
from typing import Protocol

PROJECT_REVISION_FILE = "public/__whybuddy_revision.json"


class WorkspaceProviderError(RuntimeError):
    """A provider operation failed or returned an unusable result."""

    def __init__(self, code: str, *, result: "ProcessResult | None" = None):
        super().__init__(code)
        self.result = result


@dataclass(frozen=True)
class ProcessResult:
    process_id: str | None = None
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    output_truncated: bool = False


@dataclass(frozen=True)
class ProcessLogChunk:
    text: str
    next_offset: int
    truncated: bool = False


@dataclass(frozen=True)
class BuildOutput:
    output_hash: str
    file_count: int
    size_bytes: int


@dataclass(frozen=True)
class WorkspaceHandle:
    workspace_id: str
    sandbox_id: str


@dataclass(frozen=True, slots=True)
class PrivatePreviewTarget:
    """Server-only ingress capability, never a wire/event/session payload.

    The runtime authority supplies its registered port. The provider verifies
    the sandbox identity and network configuration, not the caller's ownership.
    Target resolution never implicitly reconnects, resumes, or extends lifetime;
    a runtime owner must explicitly establish the provider connection beforehand.
    Deliberately separate from models.project_runtime and generated schemas.
    Do not serialize this object with dataclasses.asdict or log headers().

    2026-09-12 real HTTP and WS probes confirmed that E2B forwards this traffic
    token into the upstream application's request headers. Until a separately
    proven ingress boundary exists, only controlled transport probes may use
    this capability; it must not be wired directly to generated application UI.
    """

    workspace_id: str
    sandbox_id: str
    port: int
    origin: str
    expires_at: float
    access_token: str = field(repr=False)

    def headers(self) -> dict[str, str]:
        return {"E2B-Traffic-Access-Token": self.access_token}


class WorkspaceProvider(Protocol):
    def create(self, *, workspace_id: str, template: str | None = None, timeout_seconds: int = 900) -> WorkspaceHandle: ...
    def find_workspaces(self, *, workspace_id: str) -> list[WorkspaceHandle]: ...
    def connect(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> WorkspaceHandle: ...
    def write_files(self, handle: WorkspaceHandle, files: dict[str, str]) -> None: ...
    def sync_files(self, handle: WorkspaceHandle, *, expected_files: dict[str, str], files: dict[str, str]) -> None: ...
    def prepare_verification(self, handle: WorkspaceHandle, verification_id: str) -> None: ...
    def inspect_build_output(self, handle: WorkspaceHandle, *, revision: str) -> BuildOutput: ...
    def start_verification_server(self, handle: WorkspaceHandle, *, verification_id: str, suite_version: str, port: int) -> ProcessResult: ...
    def cleanup_verification_data(self, handle: WorkspaceHandle, verification_id: str) -> None: ...
    def read_application_data(self, handle: WorkspaceHandle) -> bytes | None: ...
    def write_application_data(self, handle: WorkspaceHandle, data: bytes) -> None: ...
    def run(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 60) -> ProcessResult: ...
    def start_process(self, handle: WorkspaceHandle, command: str, *, timeout_seconds: int = 900) -> ProcessResult: ...
    def start_preview_tunnel(self, handle: WorkspaceHandle, *, agent_source: str, relay_origin: str,
                             token: str, port: int, expires_at: float) -> ProcessResult: ...
    def is_process_running(self, handle: WorkspaceHandle, process_id: str) -> bool: ...
    def process_result(self, handle: WorkspaceHandle, process_id: str) -> ProcessResult: ...
    def read_process_logs(self, handle: WorkspaceHandle, process_id: str, *, offset: int = 0) -> ProcessLogChunk: ...
    def probe(self, handle: WorkspaceHandle, port: int, *, expected_revision: str) -> bool: ...
    def renew(self, handle: WorkspaceHandle, *, timeout_seconds: int = 900) -> None: ...
    def preview_url(self, handle: WorkspaceHandle, port: int) -> str: ...
    def private_preview_target(self, handle: WorkspaceHandle, port: int) -> PrivatePreviewTarget: ...
    def stop(self, handle: WorkspaceHandle, process_id: str) -> None: ...
    def destroy(self, handle: WorkspaceHandle) -> None: ...
