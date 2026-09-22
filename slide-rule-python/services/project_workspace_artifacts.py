"""Trusted filesystem helpers for production builds and application snapshots.

The generated project never supplies a path for these operations. The provider
passes its fixed workspace root; directory descriptors reject symlink traversal,
and deletion unlinks links rather than following them. stdout is bounded metadata
or a bounded SQLite snapshot, never arbitrary build output.
"""

MAX_APPLICATION_DATA_BYTES = 8 * 1024 * 1024
MAX_OFFICE_COLLECT_BYTES = 16 * 1024 * 1024
ARTIFACT_IO_SCRIPT = r'''
import base64, hashlib, json, os, re, stat, sys, uuid
job = json.load(sys.stdin)
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
def directory(path, create=False):
    fd = os.open("/", flags)
    try:
        for part in path.strip("/").split("/"):
            if part in ("", ".", ".."): raise ValueError("invalid_directory")
            if create:
                try: os.mkdir(part, mode=0o700, dir_fd=fd)
                except FileExistsError: pass
            nxt = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise
def regular(fd, name, limit):
    stream = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        meta = os.fstat(stream)
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > limit: raise ValueError("invalid_file")
        with os.fdopen(stream, "rb", closefd=False) as reader:
            data = reader.read(limit + 1)
        if len(data) > limit: raise ValueError("file_too_large")
        return data
    finally: os.close(stream)
visited = 0
def bounded_visit(depth):
    global visited
    visited += 1
    if depth > 64 or visited > 10000: raise ValueError("artifact_tree_limit")
def remove(fd, name, depth=0):
    bounded_visit(depth)
    try: mode = os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode
    except FileNotFoundError: return
    if stat.S_ISDIR(mode):
        nested = os.open(name, flags, dir_fd=fd)
        try:
            for entry in os.listdir(nested): remove(nested, entry, depth + 1)
        finally: os.close(nested)
        os.rmdir(name, dir_fd=fd)
    else: os.unlink(name, dir_fd=fd)
action, root = job["action"], job["root"]
if action in ("prepare", "cleanup"):
    identity = job["verificationId"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identity): raise ValueError("invalid_verification_id")
    outer = directory("/home/user/.whybuddy-verification", create=True)
    try:
        remove(outer, identity)
        if action == "prepare":
            os.mkdir(identity, mode=0o700, dir_fd=outer)
            target = os.open(identity, flags, dir_fd=outer)
            try: os.mkdir("data", mode=0o700, dir_fd=target)
            finally: os.close(target)
    finally: os.close(outer)
    if action == "prepare":
        project = directory(root)
        try: remove(project, "dist")
        finally: os.close(project)
    print(json.dumps({"ok": True}))
elif action == "output":
    dist = directory(root + "/dist")
    entries, total = [], 0
    def visit(fd, prefix="", depth=0):
        global total
        bounded_visit(depth)
        for name in sorted(os.listdir(fd)):
            bounded_visit(depth)
            path = prefix + name
            mode = os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode
            if stat.S_ISDIR(mode):
                child = os.open(name, flags, dir_fd=fd)
                try: visit(child, path + "/", depth + 1)
                finally: os.close(child)
            elif stat.S_ISREG(mode):
                if len(entries) >= 5000: raise ValueError("build_file_limit")
                data = regular(fd, name, 104857600 - total)
                total += len(data)
                entries.append([path, len(data), hashlib.sha256(data).hexdigest()])
            else: raise ValueError("build_file_not_regular")
    try:
        if not regular(dist, "index.html", 104857600): raise ValueError("build_index_empty")
        marker = json.loads(regular(dist, "__whybuddy_revision.json", 4096))
        if marker.get("revision") != job["revision"]: raise ValueError("build_revision_mismatch")
        visit(dist)
    finally: os.close(dist)
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    print(json.dumps({"outputHash": hashlib.sha256(encoded).hexdigest(), "fileCount": len(entries), "sizeBytes": total}))
elif action in ("read-data", "write-data"):
    cap = 8388608
    if action == "write-data":
        # Restore is allowed only before source has been mounted. A current
        # project marker rejects attempts to overwrite a live application DB.
        try:
            public = directory(root + "/public")
        except FileNotFoundError: public = None
        if public is not None:
            try:
                try: os.stat("__whybuddy_revision.json", dir_fd=public, follow_symlinks=False)
                except FileNotFoundError: pass
                else: raise ValueError("application_data_already_mounted")
            finally: os.close(public)
        data = base64.b64decode(job["data"], validate=True)
        if not 16 <= len(data) <= cap or not data.startswith(b"SQLite format 3\x00"):
            raise ValueError("application_data_invalid")
        folder = directory("/home/user/.whybuddy-application", create=True)
        temporary = ".wb-data-" + uuid.uuid4().hex
        try:
            try: os.stat("tasks.sqlite", dir_fd=folder, follow_symlinks=False)
            except FileNotFoundError: pass
            else: raise ValueError("application_data_already_present")
            output = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            with os.fdopen(output, "wb") as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            # Link with exclusive destination; even a concurrent creator cannot
            # be overwritten between the check and the atomic publication.
            os.link(temporary, "tasks.sqlite", src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
            os.unlink(temporary, dir_fd=folder)
        finally:
            try: os.unlink(temporary, dir_fd=folder)
            except FileNotFoundError: pass
            os.close(folder)
        print(json.dumps({"ok": True}))
    else:
        try: folder = directory("/home/user/.whybuddy-application")
        except FileNotFoundError: folder = None
        data = None
        if folder is not None:
            try:
                try: data = regular(folder, "tasks.sqlite", cap)
                except FileNotFoundError: pass
            finally: os.close(folder)
        if data is not None and not data.startswith(b"SQLite format 3\x00"): raise ValueError("application_data_invalid")
        print(json.dumps({"data": base64.b64encode(data).decode() if data is not None else None}))
elif action == "collect-office":
    skip = {"node_modules", ".venv", "__pycache__", ".git", "dist"}
    suffix = (".pptx", ".docx", ".xlsx")
    cap = 8388608
    files, total = [], 0
    def visit(fd, prefix="", depth=0):
        global total
        bounded_visit(depth)
        for name in sorted(os.listdir(fd)):
            bounded_visit(depth)
            mode = os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode
            if stat.S_ISDIR(mode):
                if name in skip: continue
                child = os.open(name, flags, dir_fd=fd)
                try: visit(child, prefix + name + "/", depth + 1)
                finally: os.close(child)
            elif stat.S_ISREG(mode):
                if not name.lower().endswith(suffix) or len(files) >= 8: continue
                try: data = regular(fd, name, cap)
                except ValueError: continue
                if not data.startswith(b"PK\x03\x04") or total + len(data) > 16777216: continue
                total += len(data)
                files.append({"path": prefix + name, "sha256": hashlib.sha256(data).hexdigest(),
                    "sizeBytes": len(data), "data": base64.b64encode(data).decode()})
    root_fd = directory(root)
    try: visit(root_fd)
    finally: os.close(root_fd)
    print(json.dumps({"files": files}))
else: raise ValueError("unknown_artifact_action")
'''

STATIC_BUILD_SERVER_SCRIPT = r'''
import http.server, pathlib, sys, urllib.parse
root = pathlib.Path(sys.argv[2]).resolve(strict=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(root), **kwargs)
    def translate_path(self, path):
        candidate = pathlib.Path(super().translate_path(path)).resolve()
        if not candidate.is_relative_to(root): return str(root / ".invalid-outside-path")
        return str(candidate)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1])), Handler)
server.serve_forever()
'''
