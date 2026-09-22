import { describe, expect, it } from "vitest";

import { mentionedSkillSlugs } from "../mentioned-skills";

describe("mentionedSkillSlugs", () => {
  it("抽出这一轮 @slug，不把 npm 版本号当技能", () => {
    expect(mentionedSkillSlugs("@office-skills 做个5页PPT")).toEqual([
      "office-skills",
    ]);
    expect(
      mentionedSkillSlugs("用 @office-skills 和 @frontend-design")
    ).toEqual(["office-skills", "frontend-design"]);
    expect(mentionedSkillSlugs("npm@2.0 升级")).toEqual([]);
    expect(mentionedSkillSlugs("做个PPT")).toEqual([]);
  });

  it("给了已装名单就只留装过的", () => {
    expect(
      mentionedSkillSlugs("@ghost 做ppt", ["office-skills"])
    ).toEqual([]);
    expect(
      mentionedSkillSlugs("@office-skills 做ppt", ["office-skills"])
    ).toEqual(["office-skills"]);
  });
});
