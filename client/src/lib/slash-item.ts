/**
 * 斜杠选择器的叶子类型。从页面目录抽上来，好让 lib 里的
 * turn-capabilities 不必倒着依赖 pages/sliderule。
 *
 * 判定函数仍在 composer-slash（页面层）；类型谁都能用。
 */
export type SlashKind = "skill" | "connector" | "partner" | "rehearsal";

/** 斜杠推演动词。不是 Claude 的 /plan /compact /mcp /commit /loop /yolo。 */
export type RehearsalSlashVerb =
  | "rehearse"
  | "refine"
  | "challenge"
  | "scope"
  | "restore";

export interface SlashItem {
  /** 唯一键（技能用安装键、连接器用 id、伙伴用 id） */
  key: string;
  kind: SlashKind;
  name: string;
  description: string;
  /**
   * 不可用的原因（比如连接器缺凭据）。可用时为空。
   *
   * ⚠ 不可用的**照样列出来并说明缺什么**。列表里干脆不出现的话，用户只会
   *   以为"这个产品没有天气"，而不是"我还没配"——跟后端 /connectors 那条
   *   同一个判断。
   */
  unavailable?: string;
}
