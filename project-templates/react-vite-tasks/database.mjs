// One application process owns this SQLite file. A successful mutation is on
// disk before its HTTP response; source revisions never contain this database.
import initSqlJs from "sql.js";
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, openSync, closeSync } from "node:fs";
import { resolve, join } from "node:path";

export const DATA_SCHEMA_VERSION = 1;
const MAX_DATABASE_BYTES = 8 * 1024 * 1024;
const hash = value => createHash("sha256").update(value).digest("hex");
export const appError = (status, code) => Object.assign(new Error(code), { status, code });
export function credentials(username, password) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9_-]{3,40}$/.test(username) ||
      typeof password !== "string" || password.length < 10 || password.length > 200)
    throw appError(400, "用户名需为3至40位字母数字，密码至少10位");
}

export async function openDatabase(directory) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const file = join(root, "tasks.sqlite"), lock = join(root, "tasks.lock");
  const lockId = randomUUID();
  if (existsSync(lock)) {
    let prior;
    try { prior = JSON.parse(readFileSync(lock, "utf8")); } catch { throw appError(503, "数据锁损坏"); }
    if (!Number.isInteger(prior.pid) || prior.pid < 1) throw appError(503, "数据锁损坏");
    try { process.kill(prior.pid, 0); throw appError(503, "数据已被另一个服务使用"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid, lockId }));
  closeSync(fd);
  let db;
  const release = () => {
    try { if (JSON.parse(readFileSync(lock, "utf8")).lockId === lockId) unlinkSync(lock); } catch { /* already released */ }
  };
  try {
    const SQL = await initSqlJs();
    const bytes = existsSync(file) ? readFileSync(file) : undefined;
    if (bytes && (bytes.length > MAX_DATABASE_BYTES || bytes.subarray(0, 16).toString() !== "SQLite format 3\0"))
      throw appError(503, "任务数据库不可读取");
    db = new SQL.Database(bytes);
    db.run("PRAGMA foreign_keys=ON");
    db.run("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value INTEGER NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('writer','reader')));" +
      "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','done')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);");
    const rows = (sql, params = []) => {
      const statement = db.prepare(sql, params), result = [];
      try { while (statement.step()) result.push(statement.getAsObject()); } finally { statement.free(); }
      return result;
    };
    const version = rows("SELECT value FROM metadata WHERE key='schema'")[0];
    if (version && version.value !== DATA_SCHEMA_VERSION) throw appError(503, "任务数据库版本不受支持");
    db.run("INSERT OR IGNORE INTO metadata(key,value) VALUES('schema',1)");
    const persist = () => {
      const data = db.export();
      if (data.length > MAX_DATABASE_BYTES) throw appError(507, "任务数据库已达到容量上限");
      const temporary = file + "." + randomUUID() + ".tmp";
      try { writeFileSync(temporary, data, { mode: 0o600 }); renameSync(temporary, file); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
      db.run("PRAGMA foreign_keys=ON");
    };
    persist();
    const transaction = execute => {
      const before = db.export();
      try { db.run("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE"); const result = execute(); db.run("COMMIT"); persist(); return result; }
      catch (error) { db.close(); db = new SQL.Database(before); db.run("PRAGMA foreign_keys=ON"); throw error; }
    };
    const addUser = (username, password, role) => {
      credentials(username, password);
      if (rows("SELECT id FROM users WHERE username=?", [username]).length) throw appError(409, "用户名已存在");
      const id = randomUUID(), salt = randomBytes(16).toString("hex");
      db.run("INSERT INTO users VALUES(?,?,?,?,?)", [id, username, salt, scryptSync(password, salt, 32).toString("hex"), role]);
      return { id, username, role };
    };
    return {
      setupRequired: () => rows("SELECT id FROM users LIMIT 1").length === 0,
      setup(username, password) { return transaction(() => {
        if (rows("SELECT id FROM users LIMIT 1").length) throw appError(409, "管理员已创建，请登录");
        return addUser(username, password, "writer");
      }); },
      createReader(username, password) { return transaction(() => addUser(username, password, "reader")); },
      login(username, password) {
        credentials(username, password);
        const user = rows("SELECT * FROM users WHERE username=?", [username])[0];
        const derived = scryptSync(password, user?.salt || "invalid-login-salt", 32);
        if (!user || !timingSafeEqual(derived, Buffer.from(user.password_hash, "hex"))) throw appError(401, "用户名或密码不正确");
        const token = randomBytes(32).toString("base64url");
        transaction(() => {
          db.run("DELETE FROM sessions WHERE expires_at<?", [Date.now()]);
          db.run("INSERT INTO sessions VALUES(?,?,?)", [hash(token), user.id, Date.now() + 12 * 3600 * 1000]);
        });
        return { token, user: { id: user.id, username: user.username, role: user.role } };
      },
      user(token) {
        if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        return rows("SELECT users.id,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?", [hash(token), Date.now()])[0] || null;
      },
      logout(token) { if (token) transaction(() => db.run("DELETE FROM sessions WHERE token_hash=?", [hash(token)])); },
      tasks(status = "all", query = "") {
        if (!["all", "open", "done"].includes(status) || typeof query !== "string" || query.length > 200) throw appError(400, "筛选条件无效");
        return rows("SELECT id,title,status,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE (?='all' OR status=?) AND instr(lower(title),lower(?))>0 ORDER BY created_at,id", [status, status, query]);
      },
      saveTask(id, title, status) {
        if (typeof title !== "string" || !title.trim() || title.trim().length > 160 || !["open", "done"].includes(status)) throw appError(400, "请输入有效任务标题和状态");
        return transaction(() => {
          const now = new Date().toISOString();
          if (id) {
            if (!rows("SELECT id FROM tasks WHERE id=?", [id]).length) throw appError(404, "任务不存在");
            db.run("UPDATE tasks SET title=?,status=?,updated_at=? WHERE id=?", [title.trim(), status, now, id]);
          } else {
            id = randomUUID(); db.run("INSERT INTO tasks VALUES(?,?,?,?,?)", [id, title.trim(), status, now, now]);
          }
          return rows("SELECT id,title,status,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE id=?", [id])[0];
        });
      },
      close() { db.close(); release(); },
    };
  } catch (error) { db?.close(); release(); throw error; }
}
