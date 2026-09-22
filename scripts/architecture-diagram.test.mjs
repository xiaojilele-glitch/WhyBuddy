// @ts-check
/**
 * 架构图必须真的能渲染（2026-08-11）。
 *
 * ## 为什么会有这个文件
 *
 * `docs/SlideRule V5.x 架构图.md` 整份是 mermaid 源码（不是带围栏的
 * markdown，是从第一行 `%%` 注释到最后一行 `classDef` 的一整张图）。
 * 写 V5.9 的时候顺手拿仓库里已装的 mermaid 解析器跑了一遍，发现：
 *
 *     V5.2 ~ V5.7   全部 OK
 *     V5.8          **解析失败**
 *
 * 也就是说 08-03 那一版发出去之后的八天里，**这张图在任何 mermaid 渲染器里
 * 都是一片红**，没有人发现——因为图从来只被人读源码，没人真去渲染它。
 *
 * 两处语法伤，都是"往一个写完了的节点后面接着补话"造成的：
 *
 *     ① 文字写到了标签外面
 *        FREEFORM["……"]:::cap<br/>✪08-03 rowsRef 取代 blockRef……
 *                        ^^^^^^ `]` 之后就不再是标签了，`<br/>` 成了裸 token
 *     ② 标签里嵌了裸双引号
 *        MONITOROV["……只有一份"一行长什么样"的模板……"]
 *                        ^ 第二个 `"` 就把标签提前收了口
 *
 * 两处的共同成因是同一个习惯：升版时在旧节点尾巴上追加新内容。所以这道闸
 * 守的不是"别写错语法"，是**"追加式升版必须仍然渲染得出来"**。
 *
 * ## 写 V6.0 时又踩到两种，都在**边标签**上（2026-08-13）
 *
 * 节点标签有引号包着，字符集很宽；**边标签没有引号，字符集窄得多**，两处
 * 规则不一样，而写图的人很容易拿节点标签的经验去写边标签：
 *
 *     ③ 边标签里用了没被词法器收录的符号
 *        ECTX -.⛔ …(⚑V6.0 复核…).-x GEN5
 *                     ^ `⛔` 一直没事，新加的 `⚑`(U+2691) 当场 Lexical error
 *     ④ **点线边的标签里出现 `.`**
 *        A -.V6.0否决:….-x B
 *              ^ 这个点把标签提前收了口 —— `-.` 开头、`.->`/`.-x` 收尾，
 *                中间再来一个 `.` 就歧义了。写 `V6` 就过
 *
 * 两条的共同教训跟 ①② 是同一条：**别把「节点标签能写」当成「哪儿都能写」**。
 * 要在边上写复杂文字，用 `==>|"…"|` 的**带引号管道形式**（图里已有大量先例），
 * 那种形式的字符集跟节点标签一致。

 *
 * ## 为什么是 node:test 而不是 vitest
 *
 * 这条判据跟客户端代码无关，被检的是 docs/ 下的文本；放 scripts/ 这一档
 * 跟 generate-block-component-usage.test.mjs 做邻居更合适。
 *
 * ## 为什么要 stub dompurify
 *
 * `mermaid.parse()` 只跑词法/语法，不碰 DOM；但 mermaid 的模块**初始化**会
 * `purify.addHook(...)`，而 DOMPurify 在没有 window 的 node 里返回的是个
 * 阉割对象，没有 addHook。为这个装一整个 jsdom 不值当——给它一个空壳即可。
 * 注意必须走 `mermaid/dist/mermaid.core.mjs`：`mermaid.esm.mjs` 把 dompurify
 * 整个打进了产物，解析钩子拦不住它。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");

/**
 * 已知损坏、且**有意不修**的历史版本。
 *
 * 它们是归档件，改动等于篡改当时的记录；留在这里是为了让这条判据仍然覆盖
 * 全部架构图，而不是缩到"只检最新那一份"（那样下一份坏掉又没人知道）。
 * 下面 `test_历史损坏件不许增加` 是双向的：修好了也得来这里删名字。
 */
const 已知损坏 = new Set(["SlideRule V5.8 架构图.md"]);

/** dompurify 空壳：解析阶段不 sanitize 任何东西，见文件头。 */
const HOOKS = `data:text/javascript,
const STUB = 'data:text/javascript,' + encodeURIComponent(
  'const p={addHook(){},removeAllHooks(){},setConfig(){},sanitize:(s)=>s,isSupported:true};export default p;'
);
export async function resolve(spec, ctx, next) {
  if (spec === 'dompurify') return { url: STUB, shortCircuit: true };
  return next(spec, ctx);
}`;
register(HOOKS);

/** @returns {string[]} docs/ 下所有架构图文件名，按版本号排序 */
function 架构图清单() {
  return fs
    .readdirSync(DOCS)
    .filter((name) => /^SlideRule V\d+\.\d+ 架构图\.md$/.test(name))
    .sort((a, b) => {
      const num = (s) => Number(String(s.match(/V(\d+\.\d+)/)?.[1] ?? 0));
      return num(a) - num(b);
    });
}

/** 图源从第一行 `flowchart` 起算——前面那一大坨 `%%` 注释 mermaid 也认，但
 *  真正要守的是图本身，且注释里天然带成对不上的引号（中文引号成对，英文的
 *  跨行成对），不截掉会白白制造假红。 */
function 取图源(name) {
  const src = fs.readFileSync(path.join(DOCS, name), "utf8");
  const at = src.indexOf("\nflowchart");
  assert.notEqual(at, -1, `${name}：整份文件里找不到 flowchart 声明`);
  return src.slice(at + 1);
}

async function 解析(name) {
  const mermaid = (await import("mermaid/dist/mermaid.core.mjs")).default;
  try {
    await mermaid.parse(取图源(name));
    return null;
  } catch (err) {
    return String(err?.message ?? err).split("\n").slice(0, 3).join(" | ");
  }
}

test("每一张架构图都解析得过（历史损坏件除外）", async () => {
  const 清单 = 架构图清单();
  assert.ok(清单.length >= 8, `只找到 ${清单.length} 份架构图，路径规则怕是变了`);

  const 坏的 = [];
  for (const name of 清单) {
    const err = await 解析(name);
    if (err && !已知损坏.has(name)) 坏的.push(`${name} :: ${err}`);
  }
  assert.deepEqual(坏的, [], `这些架构图在 mermaid 里渲染不出来：\n${坏的.join("\n")}`);
});

test("历史损坏件不许增加，修好了也要来这里销名", async () => {
  for (const name of 已知损坏) {
    assert.ok(
      架构图清单().includes(name),
      `豁免名单里的 ${name} 已经不存在了，请把它从名单里删掉`
    );
    assert.notEqual(
      await 解析(name),
      null,
      `${name} 现在能解析了——把它从「已知损坏」里删掉，这条判据才继续有意义`
    );
  }
});

test("最新那一份必须是最严的：节点标签不许被写到括号外面", () => {
  // 这是 V5.8 踩的第一种伤。语法闸已经能抓到它，这里额外点名，是为了让
  // 失败信息直接说人话——jison 报的是「got 'TAGSTART'」，读的人未必反应得过来。
  const 最新 = 架构图清单().at(-1);
  const 越界 = 取图源(最新)
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /:::[a-zA-Z]+\s*<br\s*\/?>/.test(line));
  assert.deepEqual(
    越界.map(([n]) => n),
    [],
    `${最新}：第 ${越界.map(([n]) => n).join("/")} 行把文字写到了 ]:::class 后面。` +
      `升版补话要补进标签里（把新内容挪到收尾的 "] 之前）`
  );
});

test("最新那一份必须是最严的：节点标签里不许有裸双引号", () => {
  // V5.8 踩的第二种伤。用「」代替即可，图上其它地方本来就是这么写的。
  const 最新 = 架构图清单().at(-1);
  const 越界 = 取图源(最新)
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !line.trimStart().startsWith("%%") && (line.match(/"/g) ?? []).length > 2);
  assert.deepEqual(
    越界.map(([n]) => n),
    [],
    `${最新}：第 ${越界.map(([n]) => n).join("/")} 行的标签里嵌了双引号，第二个引号会把标签提前收口。改用「」`
  );
});
