/**
 * 会话列表的共享取数（2026-08-23）。
 *
 * 侧栏（SidebarSessions）和应用中心（AppsWorkbench）在**同一屏**里各拉了一次
 * `GET /api/sliderule/sessions`，两边互相不知道对方拉过——真机实测该页首屏这
 * 个端点被打了 2 次、47.1 KB，是纯白干的活（CDP 调用栈同时指到
 * SidebarSessions 和 AppsWorkbench 两处）。
 *
 * ## 为什么是"并发合流"，不是"带 TTL 的缓存"
 *
 * 侧栏删掉一个会话之后会立刻 refresh()。加时间缓存就得回答"多久算新"，
 * 答错的现象是**删了还在列表里**——比多打一次请求难受得多。
 *
 * 这里只做一件事：**同一时刻在飞的请求只留一个，后来者共享它**。首屏两个组件
 * 在同一拍挂载，所以 2 次变 1 次；而任何一次"先改后拉"都拿不到旧结果，因为
 * 改完时那次请求早就结束、飞行槽是空的。真要保险，改完调 invalidateSessionsList()。
 *
 * ⚠ 别把它升级成"结果缓存"。这个模块的全部价值是**没有陈旧窗口**。
 */

export interface SessionsListBody {
  sessions?: unknown[];
  [key: string]: unknown;
}

const ENDPOINT = "/api/sliderule/sessions";

let inflight: Promise<SessionsListBody> | null = null;
/** 当前飞行槽的身份令牌——用来判断 finally 里该不该清槽。 */
let slot: object | null = null;

/**
 * 拉会话列表。并发调用共享同一个请求。
 *
 * 失败照常 reject——两个调用方各自的错误提示不一样，这里不替它们吞。
 */
export function fetchSessionsList(): Promise<SessionsListBody> {
  if (inflight) return inflight;
  // 用一个独立令牌判断「飞行槽还是不是这一次的」，而不是在 run 的初始化里引用
  // run 自己——那样运行时对（finally 跑在 await 之后），但 TS 会判成
  // "used before being assigned"。
  const token = {};
  const run = (async () => {
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SessionsListBody;
    } finally {
      // ⚠ 清飞行槽必须在**函数体内**的 finally 里，不能挂在返回的 promise 上
      //   （`run.finally(...)`）。挂在外面时，它和调用方的 await 恢复同属微
      //   任务队列，调用方可能先跑——于是"上一次已经结束了"的下一次调用还能
      //   看见旧的飞行槽，被当成并发合流进去，拿到的是上一次的结果。
      //   第一版就是这么写的，被 sessions-list-client.test 的"不是缓存"那条
      //   当场咬住：明明该发两次，实际只发了一次。
      if (slot === token) inflight = null;
    }
  })();
  slot = token;
  inflight = run;
  // 失败也要能被下一次重发——这由上面的 finally 保证；这里额外吞一次拒绝，
  // 免得没人 catch 时冒成 unhandledrejection（调用方各自的 catch 照常收到）。
  void run.catch(() => {});
  return run;
}

/** 改过会话（删/建/改名）之后调一下：让下一个调用方一定发新请求。 */
export function invalidateSessionsList(): void {
  inflight = null;
  slot = null;
}

/** 测试用：把飞行槽清回初始。 */
export function __resetSessionsListForTests(): void {
  inflight = null;
  slot = null;
}
