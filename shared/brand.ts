/**
 * WhyBuddy brand constants.
 *
 * The project's user-facing brand is WhyBuddy.
 *
 * Strategy: alias-first, not big-bang rename. Internal symbols (file names,
 * module identifiers, audit / lineage event families, the 287 spec dirs that
 * mention old names) keep their existing strings unless a coordinated rename
 * is safe; user-visible touchpoints consume these constants.
 *
 * The legacy package name stays exported here (`BRAND_PACKAGE_LEGACY`) for
 * the small number of modules that need to reference the old token while a
 * future `whybuddy-internal-rename` spec carries out a coordinated sweep.
 */

export const BRAND_NAME_DISPLAY = "WhyBuddy";
export const BRAND_NAME_LATIN = "WhyBuddy";
export const BRAND_NAME_FULL = "WhyBuddy";
export const BRAND_DOMAIN = "whybuddy.ai";

export const BRAND_TAGLINE_ZH = "把想法问清楚，把产品跑起来";
export const BRAND_TAGLINE_EN = "Clarify ideas, preview products, and move faster.";

/**
 * One-line product tagline that combines display name + tagline. Used by the
 * HTML <title> and the login subtitle.
 */
export const BRAND_HEADLINE_ZH = `${BRAND_NAME_DISPLAY} · 任务自动驾驶`;
export const BRAND_HEADLINE_EN = `${BRAND_NAME_LATIN} · Task Autopilot`;

/**
 * Legacy package name — kept for places that still need to reference the
 * old token while the internal rename is staged.
 */
export const BRAND_PACKAGE_LEGACY = "whybuddy";
