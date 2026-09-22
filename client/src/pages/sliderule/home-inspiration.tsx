/**
 * 空态底栏——一句导去应用市场，不画卡。
 *
 * ⚠ 2026-08-19 先做过三张假示意，再做过 listApps + justified 作品墙。
 *   用户当场指着「需要灵感？ / 应用中心」那一行说：直接显示这个就挺好，
 *   别再铺卡片。灵感入口是去应用市场 Fork，不是把别人的 goal 填进输入框。
 * ⚠ 2026-08-20：侧栏货架已经叫「应用市场」，这句链接还写「应用中心」——
 *   同一扇门两个名字。改成跟侧栏一致。
 */
export const INSPIRATION_LEAD = "需要灵感？";
export const INSPIRATION_LINK = "应用市场";
export const INSPIRATION_TAIL = "，Fork一下，快人一步";

export function HomeInspiration() {
  return (
    <section
      className="w-full px-1 pb-5 pt-3"
      data-testid="sliderule-inspiration"
      aria-label={`${INSPIRATION_LEAD}${INSPIRATION_LINK}${INSPIRATION_TAIL}`}
    >
      <p className="text-center text-[15px] leading-7 text-[#171717] sm:text-[16px]">
        {INSPIRATION_LEAD}
        <a
          href="/agent-loop/workbench"
          className="font-semibold text-[#1558d6] underline decoration-[#1558d6]/35 underline-offset-[5px] transition hover:decoration-[#1558d6]"
          data-testid="sliderule-inspiration-all"
        >
          {INSPIRATION_LINK}
        </a>
        {INSPIRATION_TAIL}
      </p>
    </section>
  );
}
