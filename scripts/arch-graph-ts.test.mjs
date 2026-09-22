// @ts-check
/**
 * TS 侧架构闸的判据（2026-08-29）。这是我们的「编译器」。
 *
 * 对应 grok-build：92 个 crate 在 `Cargo.toml` 里显式声明依赖，364 条内部边由
 * 编译器强制，循环依赖在 Rust 里根本编译不出来。TS 没有这个，所以自己数。
 *
 * ## ⚠ 每一条正向判据都配了反向判据
 *
 * 这仓数到第十次以上的失败形态是「闸全绿但东西没了」——正向判据齐全，反向判据
 * 缺失（CLAUDE.md 第三条）。所以：
 *
 *     "不许有新的未声明边"      配  "基线里躺着的已修条目要清掉"（只许变短）
 *     "声明的边都得存在"        配  "存在的边都得被声明"
 *     "图和代码同步"            配  "生成是确定性的"（两次生成必须逐字节相同）
 *     "扫描器扫得出边"          配  "扫描器没把测试文件算进来"
 *
 * ## ⚠ 扫描器自己也要变异验
 *
 * 本仓旧账：一个报 0 的扫描器和一条全绿的判据长得一模一样。所以下面有
 * `Test扫描器自己没瞎`——拿构造出来的样本证明它**真的会报**，
 * 而不是恰好什么都没扫到。
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import * as A from "./arch-graph-ts.mjs";

const G = A.buildGraph();
const M = A.loadManifest();
const B = M.baseline ?? {};

/** 造一个临时小仓，用来变异验扫描器本身。 */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "archts-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  return root;
}

function cycleFixture() {
  return fixture({
    "shared/a.ts": "import './b.js';\n",
    "shared/b.ts": "import './c.js';\n",
    "shared/c.ts": "import './a.js';\n",
  });
}

function fixtureManifest(g) {
  const m = {
    layer: { shared: { mayDependOn: [] } },
    component: Object.fromEntries([...g.modules].map((mod) => [mod.replaceAll("/", "-"), {
      paths: [mod],
      mayDependOn: [...new Set(g.edges.filter((e) => e.src === mod).map((e) => e.dst.replaceAll("/", "-")))],
    }])),
    entrypoints: { patterns: [] },
    baseline: {},
  };
  m.baseline = {
    violations: [], componentViolations: [],
    cyclicEdges: A.crossComponentCyclicEdges(g, m),
    componentCyclicEdges: A.componentCyclicEdges(g, m),
    orphans: A.orphans(g, m),
  };
  return m;
}

describe("review regression: scanner and complete checks", () => {
  test("a valid TS generic arrow does not swallow the following import", () => {
    const root = fixture({
      "shared/a.ts": "export const id = <T>(x: T) => x;\nimport './b.js';\n",
      "shared/b.ts": "export {};\n",
      "shared/view.tsx": "export const view = <div />;\nimport './b.js';\n",
    });
    try {
      assert.deepEqual(A.buildGraph(root).edges.map((e) => `${e.src} -> ${e.dst}`), [
        "shared/a -> shared/b", "shared/view -> shared/b",
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("an incomplete parse fails the scan instead of hiding imports", () => {
    const root = fixture({ "shared/a.ts": "export const broken = ;\n" });
    try {
      assert.throws(() => A.buildGraph(root), /shared\/a\.ts:1:\d+.*Expression expected/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("adding an edge within an existing SCC is new debt and is drawn as cyclic", () => {
    const root = cycleFixture();
    try {
      const before = A.buildGraph(root);
      const m = fixtureManifest(before);
      assert.deepEqual(A.findCyclicEdges(before), [
        "shared/a -> shared/b", "shared/b -> shared/c", "shared/c -> shared/a",
      ]);
      writeFileSync(join(root, "shared/a.ts"), "import './b.js';\nimport './c.js';\n", "utf8");
      const after = A.buildGraph(root);
      m.component["shared-a"].mayDependOn.push("shared-c");
      const problems = A.validateGraph(after, m);
      assert.deepEqual(problems.find((p) => p.code === "new:cyclicEdges")?.items, ["shared/a -> shared/c"]);
      assert.deepEqual(problems.find((p) => p.code === "new:componentCyclicEdges")?.items, ["shared-a -> shared-c"]);
      assert.ok(A.renderDoc(after, m).includes("shared-a -.->|环| shared-c"));
      assert.ok(!A.renderDoc(after, m).includes("shared-a --> shared-c"));
      assert.ok(A.renderDoc(after, m).includes("linkStyle 0,1,2,3 stroke:#dc2626"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("allowInternalCycles exempts only SCCs wholly within the opted component", () => {
    const root = cycleFixture();
    try {
      const g = A.buildGraph(root);
      const m = { component: { one: { paths: ["shared"], allowInternalCycles: true } } };
      assert.deepEqual(A.crossComponentCyclicEdges(g, m), []);
      m.component.two = { paths: ["shared/c"], allowInternalCycles: true };
      assert.equal(A.crossComponentCyclicEdges(g, m).length, 3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("the real server SCC rejects an extra core-to-route import", () => {
    const src = "server/core/agent", dst = "server/routes/rag";
    assert.ok(G.modules.has(src) && G.modules.has(dst));
    assert.ok(!G.edges.some((e) => e.src === src && e.dst === dst));
    const mutated = { ...G, edges: [...G.edges, {
      src, dst, srcPkg: "server", dstPkg: "server", deferred: false, typeOnly: false, line: 1,
    }] };
    const added = A.validateGraph(mutated, M).find((p) => p.code === "new:cyclicEdges");
    assert.ok(added?.items.includes(`${src} -> ${dst}`));
  });

  test("the real client library cannot import the SlideRule page even when ordinary debt is accepted", () => {
    const src = "client/src/lib/sliderule-runtime";
    const dst = "client/src/pages/sliderule/useSlideRuleSession";
    assert.ok(G.modules.has(src) && G.modules.has(dst));
    assert.ok(!G.edges.some((e) => e.src === src && e.dst === dst));
    const mutated = { ...G, edges: [...G.edges, {
      src, dst, srcPkg: "client", dstPkg: "client", deferred: false, typeOnly: false, line: 1,
    }] };
    const accepted = structuredClone(M);
    accepted.component["client-lib"].mayDependOn.push("client-pages-sliderule");
    accepted.baseline.cyclicEdges = A.crossComponentCyclicEdges(mutated, accepted);
    accepted.baseline.componentCyclicEdges = A.componentCyclicEdges(mutated, accepted);
    accepted.baseline.orphans = A.orphans(mutated, accepted);
    assert.deepEqual(A.validateGraph(mutated, accepted), [{
      code: "client-lib-page-dependency", items: [`${src} -> ${dst}`],
    }]);
  });

  test("CLI check shares coverage, reverse ratchets, hard package and document checks", () => {
    const root = cycleFixture();
    try {
      const g = A.buildGraph(root);
      const m = fixtureManifest(g);
      const manifestPath = join(root, "architecture.ts.json");
      const diagramPath = join(root, "diagram.md");
      const messages = [];
      const options = { root, manifestPath, diagramPath, log: (msg) => messages.push(msg), error: (msg) => messages.push(msg) };
      const write = (manifest, doc = A.renderDoc(g, manifest)) => {
        writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
        writeFileSync(diagramPath, doc, "utf8");
      };
      write(m, A.renderDoc(g, m).replaceAll("\n", "\r\n"));
      assert.equal(A.main(["--check"], options), 0, messages.join("\n"));
      write(m, "tampered");
      assert.equal(A.main(["--check"], options), 1);
      assert.match(messages.at(-1), /document-sync/);
      const unowned = structuredClone(m);
      delete unowned.component["shared-a"];
      write(unowned);
      assert.equal(A.main(["--check"], options), 1);
      assert.match(messages.at(-1), /unowned-modules/);
      const stale = structuredClone(m);
      stale.baseline.orphans.push("shared/deleted");
      stale.component["shared-a"].mayDependOn.push("shared-a");
      write(stale);
      assert.equal(A.main(["--check"], options), 1);
      assert.match(messages.at(-1), /stale:orphans/);
      assert.match(messages.at(-1), /stale-component-declarations/);
      const cyclicPackages = {
        modules: new Set(["client/a", "server/b"]), filesScanned: 2,
        edges: [
          { src: "client/a", dst: "server/b", srcPkg: "client", dstPkg: "server" },
          { src: "server/b", dst: "client/a", srcPkg: "server", dstPkg: "client" },
        ],
      };
      const withDebt = fixtureManifest(cyclicPackages);
      withDebt.baseline.violations = A.layerViolations(cyclicPackages, withDebt);
      assert.ok(A.validateGraph(cyclicPackages, withDebt).some((p) => p.code === "package-cycles"));
      writeFileSync(join(root, "shared/a.ts"), "export {};\n", "utf8");
      for (const pkg of ["client", "server"]) mkdirSync(join(root, pkg));
      writeFileSync(join(root, "client/a.ts"), "import '../server/b.js';\n", "utf8");
      writeFileSync(join(root, "server/b.ts"), "import '../client/a.js';\n", "utf8");
      const fullGraph = A.buildGraph(root);
      const acceptedEdges = fixtureManifest(fullGraph);
      acceptedEdges.layer.client = { mayDependOn: ["server"] };
      acceptedEdges.layer.server = { mayDependOn: ["client"] };
      write(acceptedEdges, A.renderDoc(fullGraph, acceptedEdges));
      assert.equal(A.main(["--check"], options), 1);
      assert.match(messages.at(-1), /package-cycles/);
      assert.equal(A.validateGraph(fullGraph, acceptedEdges).length, 1,
        "the hard package-cycle rule must fail even with all ordinary debt accepted");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("依赖必须先声明", () => {
  test("CLI 与测试共用全部架构规则", () => {
    assert.deepEqual(A.validateGraph(G, M, { document: readFileSync(A.DIAGRAM, "utf8") }), []);
  });

  test("没有新增的未声明跨包依赖", () => {
    const now = A.layerViolations(G, M);
    const extra = now.filter((x) => !(B.violations ?? []).includes(x));
    assert.deepEqual(extra, [], `新增了未声明的跨包依赖：${extra.join(", ")}\n` +
      `包级边界是这仓最贵的一条（client 拿 Node-only 代码、server 拿浏览器代码，` +
      `打包器不一定当场报错）。要么别连，要么在 architecture.ts.json 的 layer 里声明并写清为什么。`);
  });

  test("没有新增的未声明组间依赖", () => {
    const now = A.componentViolations(G, M);
    const extra = now.filter((x) => !(B.componentViolations ?? []).includes(x));
    assert.deepEqual(extra, [], `新增了未声明的组间依赖：${extra.join(", ")}`);
  });

  test("⚠ 反向：声明了却没有边的组间依赖要清掉", () => {
    // Python 侧 §23.7 是还完债之后**手工**发现这个漏筛的：闸只查「用了没声明」，
    // 从来不查「声明了没用」。过期声明是一张空白支票——哪天真长出这条边，闸直接放行。
    const stale = A.staleComponentDeclarations(G, M);
    assert.deepEqual(stale, [], `这些组间依赖声明了却没有任何一条边对应，从 architecture.ts.json 删掉：${stale.join(", ")}`);
  });

  test("⚠ 反向：声明了却没有边的跨包依赖要清掉", () => {
    const stale = A.staleLayerDeclarations(G, M);
    assert.deepEqual(stale, [], `这些跨包依赖声明了却没有边：${stale.join(", ")}`);
  });

  test("⚠ 反向：基线只许变短", () => {
    for (const [key, fn] of [
      ["violations", () => A.layerViolations(G, M)],
      ["componentViolations", () => A.componentViolations(G, M)],
      ["cyclicEdges", () => A.crossComponentCyclicEdges(G, M)],
      ["componentCyclicEdges", () => A.componentCyclicEdges(G, M)],
      ["orphans", () => A.orphans(G, M)],
    ]) {
      const now = new Set(fn());
      const stale = (B[key] ?? []).filter((x) => !now.has(x));
      assert.deepEqual(stale, [], `baseline.${key} 里这些已经还清了，删掉：${stale.slice(0, 5).join(", ")}`);
    }
  });
});

describe("循环依赖只许变少", () => {
  test("没有新增的模块级环", () => {
    const extra = A.crossComponentCyclicEdges(G, M).filter((x) => !(B.cyclicEdges ?? []).includes(x));
    assert.deepEqual(extra, [], `新增了循环依赖：${extra.join("\n")}\n` +
      `TS 不会因此报错——它会让你把 import 改成 await import() 继续跑，然后在某个打包顺序上炸。`);
  });

  test("没有新增的组间环", () => {
    const extra = A.componentCyclicEdges(G, M).filter((x) => !(B.componentCyclicEdges ?? []).includes(x));
    assert.deepEqual(extra, [], `新增了组间环：${extra.join("\n")}`);
  });

  test("包级不许成环（无基线，硬闸）", () => {
    // ⚠ 这条**不设基线**：今天是 0，client/server/shared 三个包的方向是干净的。
    // 一旦成环就意味着浏览器包和 Node 包互相依赖，那是打包器层面的病，不是欠账。
    assert.deepEqual(A.packageCyclicEdges(G), [], "包级成环了——client/server/shared 的方向必须是单向的");
  });

  test("client-lib 不再倒着依赖 pages-sliderule", () => {
    const back = A.validateGraph(G, M).filter((p) => p.code === "client-lib-page-dependency");
    assert.deepEqual(back, [], "推演主路径的库层又倒着依赖页面了");
  });
});

describe("成员关系", () => {
  test("每个模块都归了组", () => {
    const owner = A.componentOf(M);
    const unowned = [...G.modules].filter((m) => !owner(m)).sort();
    assert.deepEqual(unowned.slice(0, 8), [],
      `这些模块没落进任何 component，等于不受约束（共 ${unowned.length} 个）。` +
      `新目录要在 architecture.ts.json 的 component 里认领。`);
  });

  test("没有新增的孤儿模块", () => {
    // ⚠ 这**不是待删清单**。页面被路由懒加载、入口、类型声明都会落进来。
    // 这里只做棘轮：新长出来的孤儿必须当场解释——要么接上，要么写进 entrypoints。
    const extra = A.orphans(G, M).filter((x) => !(B.orphans ?? []).includes(x));
    assert.deepEqual(extra, [], `新增了没人 import 的模块：${extra.join(", ")}\n` +
      `要么把它接上，要么写进 architecture.ts.json 的 entrypoints 并说明为什么它是入口。`);
  });

  test("⚠ 入口声明不许当消孤儿的开关", () => {
    // 任何能一口气罩住整个包的模式（client/** 之类）直接红——那不是声明入口，
    // 是把判据关掉。同 Python 侧 `test_入口声明不许当消孤儿的开关`。
    for (const p of M.entrypoints?.patterns ?? []) {
      const head = p.split("*")[0];
      assert.ok(head.includes("/") && head.length > 6,
        `entrypoints 模式 "${p}" 罩得太宽，等于把孤儿判据关掉`);
    }
  });
});

describe("图与代码同步", () => {
  test("仓里那份图就是现在重新生成的那份", () => {
    const onDisk = readFileSync(A.DIAGRAM, "utf8");
    assert.equal(A.normalizeDocument(A.renderDoc(G, M)), A.normalizeDocument(onDisk),
      "docs/WhyBuddy TS 架构图（自动生成）.md 与代码不同步。" +
      "别手改它——跑 `node scripts/arch-graph-ts.mjs --emit`。");
  });

  test("⚠ 反向：生成是确定性的", () => {
    // 不确定就等于没修：两台电脑生成的文件不一样，判据每次都红，
    // 下一个人就会把它注释掉。而「多台电脑架构不一致」正是要治的病。
    assert.equal(A.renderDoc(G, M), A.renderDoc(A.buildGraph(), A.loadManifest()));
  });

  test("红虚线是欠账看板且基线只许变短", () => {
    const doc = A.renderDoc(G, M);
    assert.ok(doc.includes("欠账看板"), "TS 图没把红虚线写成欠账看板");
    assert.ok(doc.includes("基线只许变短"));
    const ccyc = A.componentCyclicEdges(G, M);
    assert.ok(ccyc.length > 0, "今天组间环是空的——这条判据会空过，改成断言 0 并删掉看板");
    assert.ok(doc.includes(ccyc[0]), `欠账看板没列出组间环：${ccyc[0]}`);
    const base = M.baseline?.componentCyclicEdges ?? [];
    const stale = base.filter((x) => !ccyc.includes(x));
    assert.deepEqual(stale, [], `baseline.componentCyclicEdges 里这些已经还清了，删掉：${stale.slice(0, 3).join(", ")}`);
  });
});

describe("扫描器自己没瞎", () => {
  test("root smoke artifacts cannot become packages, while product artifact modules remain scanned", () => {
    const root = fixture({
      "artifacts/preview-smoke/main.ts": "export const smoke = true;\n",
      "artifacts/postgres-tools/template.js": "const servers = {{ server_types }};\n",
      "client/src/artifacts/ledger.ts": "export const ledger = 1;\n",
      "client/src/main.ts": "import { ledger } from './artifacts/ledger'; export const app = ledger;\n",
    });
    try {
      assert.deepEqual(A.discoverPackages(root), ["client"]);
      const g = A.buildGraph(root);
      assert.ok(g.modules.has("client/src/artifacts/ledger"));
      assert.equal(g.edges.length, 1);
      assert.ok(A.sources(root, ["artifacts", "client"]).every(path => !path.startsWith("artifacts/")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("包名单是从磁盘派生的，不是手写的", () => {
    // Python 侧的教训：手写名单漏了 stdio_utf8，而名单同时是「哪些 import 算内部边」
    // 的筛子——漏掉的包结构上不可能有入边，在零入度名单里显示成"没人用"。
    const derived = A.discoverPackages();
    const missing = A.SEED_PACKAGES.filter((p) => !derived.includes(p));
    assert.deepEqual(missing, [], `派生的包名单少了：${missing.join(", ")}`);
  });

  test("静态 import 扫得出来", () => {
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "server/a.ts": "import { x } from '../shared/x.js';\nexport const a = x;\n",
    });
    try {
      const g = A.buildGraph(root);
      assert.equal(g.edges.length, 1, "静态 import 没被扫出来");
      assert.equal(g.edges[0].dst, "shared/x");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 动态 import 藏进函数体照样算数", () => {
    // 这是 TS 侧的逃生口，对应 Python 的函数体 import。不算它，
    // 「把 import 改成 await import()」就是一句话绕过这道闸。
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "server/a.ts": "export async function go() {\n  const m = await import('../shared/x.js');\n  return m.x;\n}\n",
    });
    try {
      const g = A.buildGraph(root);
      assert.equal(g.edges.length, 1, "动态 import 没被扫出来——闸有一个一句话的绕法");
      assert.equal(g.edges[0].deferred, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ require() 也算数", () => {
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "server/a.ts": "function go() { return require('../shared/x.js'); }\nexport { go };\n",
    });
    try {
      assert.equal(A.buildGraph(root).edges.length, 1, "require() 没被扫出来");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 类型 import 也算边（契约耦合）", () => {
    const root = fixture({
      "shared/x.ts": "export type X = { a: number };\n",
      "server/a.ts": "import type { X } from '../shared/x.js';\nexport const a: X = { a: 1 };\n",
    });
    try {
      const g = A.buildGraph(root);
      assert.equal(g.edges.length, 1, "类型 import 没被算成边");
      assert.equal(g.edges[0].typeOnly, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 注释和字符串里的 import 不算数（这就是不用正则的原因）", () => {
    // CLAUDE.md 第二条踩过的形状：判据 grep 标识符，而那个词同时出现在
    // 文档字符串里 → 变异后照样绿。正则扫 import 会把下面三种全当真。
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "server/a.ts": [
        "// import { x } from '../shared/x.js';",
        "/** 老写法是 import { x } from '../shared/x.js' */",
        "const s = \"import { x } from '../shared/x.js'\";",
        "export const a = s.length;",
      ].join("\n") + "\n",
    });
    try {
      assert.equal(A.buildGraph(root).edges.length, 0, "注释/字符串里的 import 被当成了真的边");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 测试文件不算进依赖图", () => {
    // Python 侧第一版用 `\"tests/\" in str(p)` 判断，而路径没有前导斜杠，
    // 于是 472 个测试文件全被算进图里，噪音压过真信号。
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "server/a.test.ts": "import { x } from '../shared/x.js';\nexport const a = x;\n",
      "server/__tests__/b.ts": "import { x } from '../../shared/x.js';\nexport const b = x;\n",
    });
    try {
      assert.equal(A.buildGraph(root).edges.length, 0, "测试文件被算进了依赖图");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 环探测器真的会报（防空转）", () => {
    // 仓里若某天环归零，「探测器坏了」和「确实没有」长得一模一样。
    // 拿自造样本证明它会报——本仓旧账：一个报 0 的扫描器和一条全绿的判据是同一种东西。
    const root = fixture({
      "shared/a.ts": "import { b } from './b.js';\nexport const a = b;\n",
      "shared/b.ts": "import { a } from './a.js';\nexport const b = a;\n",
    });
    try {
      const cycles = A.findCyclicEdges(A.buildGraph(root));
      assert.deepEqual(cycles, ["shared/a -> shared/b", "shared/b -> shared/a"],
        "环探测器必须报出构造出来的环的全部边");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("⚠ 未声明边探测器真的会报（防空转）", () => {
    const root = fixture({
      "shared/x.ts": "export const x = 1;\n",
      "client/y.ts": "import { x } from '../shared/x.js';\nexport const y = x;\n",
    });
    try {
      const g = A.buildGraph(root);
      const empty = { layer: { client: { mayDependOn: [] }, shared: { mayDependOn: [] } }, component: {}, baseline: {} };
      assert.deepEqual(A.layerViolations(g, empty), ["client -> shared"],
        "未声明边探测器没报——它可能一直在空转");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("这仓真的扫出了东西（不是空图）", () => {
    assert.ok(G.modules.size > 1500, `只扫到 ${G.modules.size} 个模块，扫描器可能瞎了`);
    assert.ok(G.edges.length > 4000, `只扫到 ${G.edges.length} 条边`);
    assert.ok(G.edges.some((e) => e.deferred), "一条动态 import 都没扫到，不合常理");
  });
});
