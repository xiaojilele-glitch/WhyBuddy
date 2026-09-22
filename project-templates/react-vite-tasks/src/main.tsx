import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type User = { id: string; username: string; role: "writer" | "reader" };
type Task = { id: string; title: string; status: "open" | "done" };
async function api(path: string, method = "GET", body?: object) {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败，请重试");
  return result;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState(false), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]), [filter, setFilter] = useState("all"), [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Task | null>(null), [message, setMessage] = useState("");
  async function loadTasks(status = filter, search = query) {
    const result = await api(`/api/tasks?status=${encodeURIComponent(status)}&q=${encodeURIComponent(search)}`);
    setTasks(result.tasks);
  }
  useEffect(() => {
    api("/api/auth/session").then(result => { setUser(result.user); setSetup(result.setupRequired); })
      .catch(reason => setError(reason.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let current = true;
    api(`/api/tasks?status=${encodeURIComponent(filter)}&q=${encodeURIComponent(query)}`)
      .then(result => { if (current) setTasks(result.tasks); }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [user, filter, query]);
  async function action(execute: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await execute(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action(async () => {
      const result = await api(setup ? "/api/auth/setup" : "/api/auth/login", "POST", { username: form.get("username"), password: form.get("password") });
      setUser(result.user); setSetup(false);
    });
  }
  if (loading) return <main className="auth"><p>正在读取账号状态…</p></main>;
  if (!user) return <main className="auth">
    <p className="eyebrow">自己的小事，有序完成</p>
    <h1 data-whybuddy-source="src/main.tsx" data-whybuddy-line="51">{setup ? "创建管理员" : "登录任务清单"}</h1>
    <p>{setup ? "创建你的独立应用账号。随后可以邀请只读成员查看任务。" : "使用这个任务应用的账号登录。"}</p>
    <form onSubmit={authenticate}>
      <label>用户名<input name="username" autoComplete="username" required minLength={3} maxLength={40} pattern={"[a-zA-Z0-9_\\-]+"} /></label>
      <label>密码<input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={10} maxLength={200} /></label>
      <button disabled={busy}>{busy ? "正在处理…" : setup ? "创建并登录" : "登录"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </main>;
  return <main className="workspace">
    <header><div><p className="eyebrow">把计划变成今天的小行动</p>
      <h1 data-whybuddy-source="src/main.tsx" data-whybuddy-line="62">任务清单</h1></div>
      <div className="identity"><span aria-label="当前用户">{user.username}</span><span className="badge">{user.role === "writer" ? "可编辑" : "只读"}</span>
        <button className="quiet" disabled={busy} onClick={() => void action(async () => {
          await api("/api/auth/logout", "POST", {}); setUser(null); setTasks([]); setEditing(null); setFilter("all"); setQuery("");
        })}>退出登录</button></div>
    </header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {user.role === "writer" ? <form className="create" data-whybuddy-source="src/main.tsx" data-whybuddy-line="69" onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
      void action(async () => { await api("/api/tasks", "POST", { title: data.get("title") }); form.reset(); await loadTasks(); });
    }}><label>任务标题<input name="title" placeholder="下一件想完成的事…" required maxLength={160} /></label><button disabled={busy}>新增任务</button></form> :
      <p className="readonly" role="note">你是只读成员，可以查看和筛选任务。</p>}
    <div className="filters"><label>筛选状态<select aria-label="筛选状态" value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="all">全部任务</option><option value="open">待办</option><option value="done">已完成</option>
    </select></label><label>搜索任务<input value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder="按标题搜索" /></label></div>
    <section aria-label="任务列表" className="tasks">
      {tasks.length === 0 && <p className="empty">当前没有匹配的任务。</p>}
      {tasks.map(task => <article key={task.id} aria-label={task.title} data-task-id={task.id}>
        {editing?.id === task.id ? <form onSubmit={event => { event.preventDefault(); void action(async () => {
          await api(`/api/tasks/${task.id}`, "PATCH", { title: editing.title, status: editing.status }); setEditing(null); await loadTasks();
        }); }}><label>编辑标题<input required maxLength={160} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
          <label>编辑状态<select aria-label="编辑状态" value={editing.status} onChange={event => setEditing({ ...editing, status: event.target.value as Task["status"] })}>
            <option value="open">待办</option><option value="done">已完成</option></select></label>
          <button disabled={busy}>保存修改</button><button className="quiet" type="button" onClick={() => setEditing(null)}>取消</button></form> :
          <><div><h2>{task.title}</h2><span className={`status ${task.status}`}>{task.status === "done" ? "已完成" : "待办"}</span></div>
            {user.role === "writer" && <button className="quiet" onClick={() => setEditing({ ...task })} aria-label={`编辑任务 ${task.title}`}>编辑</button>}</>}
      </article>)}
    </section>
    {user.role === "writer" && <details><summary>新增只读成员</summary><form className="members" onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
      void action(async () => { await api("/api/users", "POST", { username: data.get("username"), password: data.get("password") }); form.reset(); setMessage("只读成员已创建"); });
    }}><label>只读用户名<input name="username" required minLength={3} maxLength={40} autoComplete="off" pattern={"[a-zA-Z0-9_\\-]+"} /></label>
      <label>只读密码<input name="password" required minLength={10} maxLength={200} type="password" autoComplete="new-password" /></label><button disabled={busy}>创建只读成员</button></form></details>}
  </main>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");
createRoot(root).render(<App />);
