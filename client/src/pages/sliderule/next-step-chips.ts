/**
 * 后续建议 chips —— 「这一轮做完了，下一步能干嘛」。
 *
 * ## 病（2026-09-14，用户对照 Manus 截图第 3 件）
 *
 * Manus 跑完给两条**针对刚做出来的东西**的下一步，点一下就接着派工：
 *
 *     为工单队列添加多维度筛选功能，支持按优先级、状态和分配人进行快速过滤。
 *     在对话线程的回复框中集成富文本编辑器，支持文本格式化、插入图片和添加附件。
 *
 * 我们这边输入条那排提示返回的是**写死的四条**——
 * 「路线对比一下」「澄清权限边界」「分析安全风险」「生成可行性报告」——
 * 跟这一轮做了什么毫无关系。所以每张截图里都是同样那两个。
 *
 * ## 数据从哪来：模型自己写的待办，不是再问一次模型
 *
 * `controlTodo` 是模型用 `todo_write` 自己列的活儿清单，本来就在 state 里。
 * 真机那一趟存的是：
 *
 *     in_progress  补丁前端：中文文案、极简样式、侧栏筛选 + 宽列表
 *     pending      核对认证与用户隔离的待办 API / SQLite
 *     pending      project_exec 跑 check/build/test 并修复
 *     pending      保留运行后申请 project_verify 并读取验证结果
 *
 * 针对这个工程、模型自己写的、已经落库了。**不用额外 LLM 调用，也编不出来**
 * ——这比「收尾时再问一次模型要建议」既省钱又诚实（那条路会凭空造出
 * 做不到的建议，正是 §7 说的伪造）。
 *
 * ## 边界
 *
 *   · 只取**没做完**的（in_progress 优先——那是它此刻正在干的下一步）。
 *   · 一条都没有就返回空，**由调用方退回通用 hint**；不自己凑一条。
 *   · 不按内容做启发式过滤（比如"看着像工具名就丢掉"）——那种规则一改
 *     模型措辞就失效，而且会把真正该做的事悄悄藏起来。宁可原样显示。
 */
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

/** 最多给几条。跟 Manus 一样是少而准，不是列一屏。 */
export const MAX_NEXT_STEP_CHIPS = 3;
/** 单条最长。
 *
 * ⚠ 2026-09-14 从 40 放宽到 80：一开始是小 pill 塞在输入条上，40 字就得截断成
 *   「联调 check/build/test，确…」；改成结果卡下面的整行之后不需要截了，
 *   整行的意义就是把话说完（见 NextStepSuggestions 头注）。
 *   留一个上限只是防脱缰的超长待办把版面撑坏。 */
const MAX_CHIP_CHARS = 80;

type TodoItem = { id?: string; status?: string; content?: string };

function unfinished(item: TodoItem): boolean {
  const status = String(item?.status || "").trim().toLowerCase();
  // ⚠ 白名单而不是「!= completed」：将来多一个 "cancelled"，
  //   黑名单写法会把它当成待办显示出来。
  return status === "in_progress" || status === "pending" || status === "";
}

/**
 * 从模型自己的待办里取下一步。没有就返回空数组（调用方负责兜底）。
 */
export function deriveNextStepChips(
  state: Pick<V5SessionState, "controlTodo"> | null | undefined
): string[] {
  const todo = state?.controlTodo;
  if (!Array.isArray(todo)) return [];

  const open = todo.filter(item => item && typeof item === "object" && unfinished(item));
  // in_progress 排前面：那是它此刻正在干的，最贴近「下一步」。
  const ordered = [
    ...open.filter(i => String(i.status || "").toLowerCase() === "in_progress"),
    ...open.filter(i => String(i.status || "").toLowerCase() !== "in_progress"),
  ];

  const seen = new Set<string>();
  const chips: string[] = [];
  for (const item of ordered) {
    const text = String(item.content || "").trim().replace(/\s+/g, " ");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    chips.push(text.length > MAX_CHIP_CHARS ? `${text.slice(0, MAX_CHIP_CHARS - 1)}…` : text);
    if (chips.length >= MAX_NEXT_STEP_CHIPS) break;
  }
  return chips;
}
