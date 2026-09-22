# Store seed packages

Complete Agent Skill zips from GitHub (SKILL.md + Apache-2.0 / MIT). Some have `scripts/`, some are instruction packs.

清单只认 [`index.json`](index.json)。不进的 slug 写在 [`deny.json`](deny.json)。

Re-pack:

```bash
slide-rule-python/.venv/bin/python skills/seeds/vendor_anthropic.py
slide-rule-python/.venv/bin/python skills/seeds/vendor_community.py
```

官方包走 `vendor_anthropic.py`。其余（Osmani / superpowers 手艺 / 精选的 wshobson / 仓根 SKILL.md 的 office-skills 与 study）走 `vendor_community.py`，按索引打 zip、补 LICENSE。

Anthropic 的 `docx` / `pptx` / `xlsx` / `pdf` 禁止再分发，不进索引。

不整仓搬：alirezarezvani 380 份、wshobson 183 份全倒、VoltAgent 1000+。`using-superpowers` / `writing-plans` / `test-driven-development` / stripe 这类不进。

`../sliderule.zip` is the in-house SPEC pack. Catalog copy must say it is not the everyday “write an app” default.
