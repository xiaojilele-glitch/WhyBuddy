"""Remote process fixture for the real build owner; real IO has separate tests."""
import hashlib
from types import MethodType

from services.workspace_provider import BuildOutput, ProcessLogChunk, ProcessResult, WorkspaceProviderError


def enable_build_provider(provider):
    if getattr(provider, "build_fixture_enabled", False):
        return provider
    provider.build_fixture_enabled = True
    provider.build_code = 0
    provider.build_running = False
    provider.build_output_hash = None
    provider.build_cleaned = []
    provider.processes = {"43": "dev"}
    provider.active_server_mode = "dev"
    provider.next_pid = 100
    def start(self, handle, command, **kwargs):
        self.commands.append(command)
        self.next_pid += 1
        pid = str(self.next_pid)
        mode = "install" if command.startswith("npm ci") else "build" if command == "npm run build" else "dev"
        self.processes[pid] = mode
        if mode == "build" and self.build_code == 0:
            self.build_output_hash = hashlib.sha256(repr(sorted(self.contents.items())).encode()).hexdigest()
        if mode == "dev": self.active_server_mode = "dev"
        return ProcessResult(pid)
    def running(self, handle, pid):
        mode = self.processes.get(pid)
        return handle.sandbox_id in self.handles and (self.install_running if mode == "install" else
            self.build_running if mode == "build" else mode in {"dev", "production"})
    def result(self, handle, pid):
        return ProcessResult(pid, exit_code=self.build_code if self.processes.get(pid) == "build" else self.install_code)
    def stop(self, handle, pid): self.processes[pid] = "stopped"
    def prepare(self, handle, identity): self.build_output_hash = None
    def inspect(self, handle, *, revision):
        if not self.build_output_hash: raise WorkspaceProviderError("project_build_output_invalid")
        return BuildOutput(self.build_output_hash, 2, 256)
    def server(self, handle, **kwargs):
        self.next_pid += 1
        pid = str(self.next_pid)
        self.processes[pid] = "production"
        self.active_server_mode = "production"
        self.build_server_config = kwargs
        return ProcessResult(pid)
    def cleanup(self, handle, identity): self.build_cleaned.append(identity)
    def logs(self, handle, pid, *, offset=0):
        value = (self.processes.get(pid, "unknown") + " output\n").encode()
        return ProcessLogChunk(value[offset:].decode(), len(value))
    for name, fn in {"start_process": start, "is_process_running": running, "process_result": result,
        "stop": stop, "prepare_verification": prepare, "inspect_build_output": inspect,
        "start_verification_server": server, "cleanup_verification_data": cleanup, "read_process_logs": logs}.items():
        setattr(provider, name, MethodType(fn, provider))
    return provider


def successful_build(rt, record):
    revision = rt.store.get_revision(record.projectId, record.revision, owner_id="alice")
    lockfile = next(item.sha256 for item in revision.manifest.files if item.path == "package-lock.json")
    return dict(kind="production", revision=record.revision, treeHash=record.treeHash, lockfileHash=lockfile,
        status="passed", installExitCode=0, buildExitCode=0, outputHash="a" * 64,
        outputFileCount=2, outputBytes=256, serverKind="static-dist", startedAt=record.startedAt,
        completedAt=record.startedAt)
