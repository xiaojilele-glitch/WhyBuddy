/**
 * 推演总结交给 streamdown 之前，把「挤成一行的列表」拆开。
 *
 * 2026-08-19 社区妇幼保健站：收口总结最后一行只剩「…丢失。- 营养」，
 * 下面「重新推演」倒是完整。两件事叠在一起——
 *
 *   1) 模型按「短列表」写，却把条目接在句号后面（`风险。- 下一条`），
 *      markdown 不认这种列表，整段变成一行；
 *   2) 官方 Response 壳用了满高，父级高度按一行算，多出来的字被挡住。
 *
 * 满高在 Response 里拆；这里只修文案。已经是空行+列表的标准 markdown
 * 原样返回，别把正常列表拆坏。
 */
export function ensureReadableChatMarkdown(text: string): string {
  const raw = (text || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return raw;
  return raw
    .replace(/([。．！？])[ \t]*[-–—][ \t]+/g, "$1\n\n- ")
    .replace(/^(?!\s*[-*•]\s)(.+)\n(?=[-*•]\s)/gm, "$1\n\n");
}
