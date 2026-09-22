// @vitest-environment jsdom
/**
 * HTML 绑定解释器 —— 穿线那一下。
 *
 * ⚠ 这是仓里第一组真的需要浏览器 DOM 的用例（此前客户端用例都走
 * `renderToStaticMarkup`，压根不碰 document）。所以顺手把 **jsdom 写进了
 * package.json 的 devDependencies**——它本来只是个传递依赖，装着但没声明。
 * 那个形状仓里记过一次：`rank-bm25` 漏在 requirements.txt 外，代码对它
 * fail-open，于是照那个状态建镜像部署，功能**一声不吭地整个失效**，本地
 * 测试还照样绿。用着没声明的依赖，早晚是同一个结局。
 *
 * 判据全部对着**真的 DOM** 断言（jsdom），不看快照、不数字符：
 * 今天在「造一个数去替代看一眼」上连栽四次，而这一层恰好是能机械判的——
 * 加一个字段就该多一列，这是 G2 组已经验过的那条真判据。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";

import {
  applyBindings,
  filterCatalogRows,
  findCatalogSearchInput,
  hasAnyDataSource,
  implicitActionFromClick,
  type BindingSource,
} from "../html-binding-runtime";
import { deriveSettledFiveSystemModel } from "../../system-screens/five-system-model";
import { deriveBindingSource } from "../derive-binding-source";
import { seedRuntimeState } from "../demo-seed";
import { initRuntimeState } from "../live-runtime";

/** 剥注释再查标识符——本仓踩过：词在 docstring 里、函数没接上，判据照样绿。 */
function runtimeSrc(): string {
  // ⚠ jsdom 下 import.meta.url 不是 file:，readFileSync 会抛。从 cwd 拼。
  const rel = "src/pages/sliderule/live-runtime/html-binding-runtime.ts";
  const found = [`client/${rel}`, rel]
    .map((c) => resolve(process.cwd(), c))
    .find((c) => existsSync(c));
  if (!found) throw new Error("html-binding-runtime.ts not found");
  return readFileSync(found, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const FIELDS = [
  { id: "plate", name: "车牌号" },
  { id: "owner", name: "车主" },
  { id: "mileage", name: "里程", type: "number" },
];

const SOURCE: BindingSource = {
  rows: {
    vehicle: [
      { id: "v1", plate: "京A·11111", owner: "张师傅", mileage: 30000, brand: "甲牌" },
      { id: "v2", plate: "京B·22222", owner: "李师傅", mileage: 10000, brand: "乙牌" },
      { id: "v3", plate: "京C·33333", owner: "王师傅", mileage: 20000, brand: "甲牌" },
    ],
  },
  fields: { vehicle: FIELDS },
};

const TABLE = `
  <table>
    <thead data-head="vehicle"><tr><th data-col>列</th></tr></thead>
    <tbody data-rows="vehicle">
      <tr><td data-cell>格</td><td><button data-action="editRecord" data-entity="vehicle">编辑</button></td></tr>
    </tbody>
  </table>`;

describe("逐行展开", () => {
  it("有几行就渲染几行", () => {
    const root = dom(TABLE);
    const r = applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(r.filled.rows).toBe(3);
    expect(r.problems).toEqual([]);
  });

  it("表头与单元格都按字段清单展开", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("thead th")).toHaveLength(3);
    expect(root.textContent).toContain("车牌号");
    expect(root.textContent).toContain("京A·11111");
  });

  it("**加一个字段就自动多一列** —— G2 验过的那条真判据", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const before = root.querySelectorAll("thead th").length;

    const grown: BindingSource = {
      rows: { vehicle: SOURCE.rows.vehicle.map((r) => ({ ...r, brand: r.brand })) },
      fields: { vehicle: [...FIELDS, { id: "brand", name: "品牌" }] },
    };
    applyBindings(root, { source: grown });

    expect(root.querySelectorAll("thead th")).toHaveLength(before + 1);
    expect(root.textContent).toContain("品牌");
    expect(root.textContent).toContain("甲牌");
  });

  it("重复调用是重建不是叠加", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    applyBindings(root, { source: SOURCE });
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("操作列这类不带 data-cell 的兄弟节点保住且留在最后", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const cells = root.querySelectorAll("tbody tr:first-child td");
    expect(cells).toHaveLength(4); // 3 字段 + 1 操作列
    expect(cells[3].querySelector("button")).not.toBeNull();
  });
});

describe("排序与截断", () => {
  it("data-sort + data-order 生效", () => {
    const root = dom(TABLE.replace('data-rows="vehicle"',
      'data-rows="vehicle" data-sort="mileage" data-order="desc"'));
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("tbody tr")!.textContent).toContain("京A");
  });

  it("空值恒沉底，不受升降序影响", () => {
    const src: BindingSource = {
      rows: { vehicle: [{ id: "a", plate: "有", mileage: null }, { id: "b", plate: "无", mileage: 5 }] },
      fields: { vehicle: FIELDS },
    };
    const root = dom(TABLE.replace('data-rows="vehicle"',
      'data-rows="vehicle" data-sort="mileage" data-order="desc"'));
    applyBindings(root, { source: src });
    // 空不是"最小"，是"没有"——降序也不该把它顶到最前
    expect(root.querySelectorAll("tbody tr")[1].textContent).toContain("有");
  });

  it("没写 data-limit 不等于只要 0 行", () => {
    // ⚠ Number(null) === 0 这个坑本仓踩过一次：缺省被解释成"限 0 行"，
    //    整张表当场变空，而且没有任何报错
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("data-limit 生效且写坏了当没写", () => {
    const one = dom(TABLE.replace('data-rows="vehicle"', 'data-rows="vehicle" data-limit="1"'));
    applyBindings(one, { source: SOURCE });
    expect(one.querySelectorAll("tbody tr")).toHaveLength(1);

    const bad = dom(TABLE.replace('data-rows="vehicle"', 'data-rows="vehicle" data-limit="abc"'));
    applyBindings(bad, { source: SOURCE });
    expect(bad.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});

describe("单值聚合", () => {
  it("count 数行数", () => {
    const root = dom('<span data-value="vehicle" data-aggregate="count"></span>');
    applyBindings(root, { source: SOURCE });
    expect(root.textContent).toBe("3");
  });

  it("sum / avg / max / min", () => {
    const mk = (k: string) => {
      const root = dom(`<span data-value="vehicle" data-aggregate="${k}" data-field="mileage"></span>`);
      applyBindings(root, { source: SOURCE });
      return root.textContent;
    };
    expect(mk("sum")).toBe("60000");
    expect(mk("avg")).toBe("20000");
    expect(mk("max")).toBe("30000");
    expect(mk("min")).toBe("10000");
  });

  it("空数据显 — 不显 0", () => {
    // 0 是个真值，拿它冒充"没有"是在撒谎（✦3 同一口径）
    const empty: BindingSource = { rows: { vehicle: [] }, fields: { vehicle: FIELDS } };
    const root = dom('<span data-value="vehicle" data-aggregate="sum" data-field="mileage"></span>');
    applyBindings(root, { source: empty });
    expect(root.textContent).toBe("—");
  });
});

describe("图表只算不画", () => {
  it("按维度分桶算出 series 挂上", () => {
    const root = dom('<div data-chart="bar" data-entity="vehicle" data-dimension="brand" data-metric="count"></div>');
    applyBindings(root, { source: SOURCE });
    const series = JSON.parse(root.querySelector("[data-chart]")!.getAttribute("data-series")!);
    expect(series).toEqual([{ name: "甲牌", value: "2" }, { name: "乙牌", value: "1" }]);
  });

  it("不在这里画 —— 画有自己一堆判据，混进来两边都测不干净", () => {
    const root = dom('<div data-chart="bar" data-entity="vehicle" data-dimension="brand"></div>');
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("svg")).toBeNull();
  });
});

describe("动作：点一下真的发事件，且不发空事件", () => {
  it("行内动作带得出当前行 id", () => {
    const seen: unknown[] = [];
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelectorAll("tbody button")[0] as HTMLElement).click();
    expect(seen).toEqual([{ kind: "editRecord", entityId: "vehicle", rowId: "v1" }]);
  });

  it("拿错行等于点了没反应 —— 第二行发的必须是 v2", () => {
    const seen: any[] = [];
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelectorAll("tbody button")[1] as HTMLElement).click();
    expect(seen[0].rowId).toBe("v2");
  });

  it("createRecord 没有行，rowId 为 null 而不是空串", () => {
    const seen: any[] = [];
    const root = dom('<button data-action="createRecord" data-entity="vehicle">新建</button>');
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelector("button") as HTMLElement).click();
    expect(seen[0]).toEqual({ kind: "createRecord", entityId: "vehicle", rowId: null });
  });

  it("取不到行 id 就不挂监听，如实报问题", () => {
    // 静默失败的形态：照挂监听 → 点下去发一个空事件 → 页面开出一个空详情，
    // 看着像"点了没反应"。actionRef 那轮补运行时判据时点过名。
    const fn = vi.fn();
    const root = dom('<button data-action="editRecord" data-entity="vehicle">改</button>');
    const r = applyBindings(root, { source: SOURCE, onAction: fn });
    (root.querySelector("button") as HTMLElement).click();
    expect(fn).not.toHaveBeenCalled();
    expect(r.problems.some((p) => p.includes("取不到行 id"))).toBe(true);
  });

  it("键盘可达 —— axe 会报但没人跑 axe，所以直接给上", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const btn = root.querySelector("tbody button")!;
    expect(btn.getAttribute("role")).toBe("button");
    expect(btn.getAttribute("tabindex")).toBe("0");
  });

  it("词表之外的 kind 拒掉", () => {
    const root = dom('<button data-action="deleteEverything" data-entity="vehicle"></button>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("封闭词表"))).toBe(true);
  });
});

describe("权限门（gates）——无权的锁住，不隐藏", () => {
  /**
   * 2026-08-14 晚：权限那只手伸进 HTML 页。模式照 CASL 的 ability：
   * 宿主按角色派生一次 gates，这里填孔时逐点查。钉住的都是断掉会
   * **静默**失效的行为：锁了还挂监听（点了照样开表单）、切角色不解锁、
   * 锁话术丢失（用户看见灰按钮不知道为什么）。
   */
  const CREATE = '<button data-action="createRecord" data-entity="vehicle">新建</button>';

  it("granted:false → 禁用 + 原因 + 不挂监听；filled.locked 计数", () => {
    const fn = vi.fn();
    const root = dom(CREATE);
    const r = applyBindings(root, {
      source: SOURCE,
      onAction: fn,
      gates: {
        role: "guest",
        roleLabel: "访客",
        createGate: { vehicle: { permission: "vehicle:create", granted: false } },
      },
    });
    const btn = root.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("data-locked")).toContain("vehicle:create");
    expect(btn.getAttribute("data-locked")).toContain("访客");
    (btn as HTMLElement).click();
    expect(fn).not.toHaveBeenCalled();
    expect(r.filled.locked).toBe(1);
    expect(r.filled.action).toBe(0);
    expect(r.problems).toEqual([]); // 没权不是错误，是判定——不进 problems
  });

  it("granted:true / 没这张卡 / 没传 gates → 都不设卡（公共动作语义）", () => {
    for (const gates of [
      { createGate: { vehicle: { permission: "vehicle:create", granted: true } } },
      { createGate: {} },
      undefined,
    ]) {
      const fn = vi.fn();
      const root = dom(CREATE);
      applyBindings(root, { source: SOURCE, onAction: fn, gates });
      (root.querySelector("button") as HTMLElement).click();
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("重复调用换角色：上一轮的锁被卸掉", () => {
    const fn = vi.fn();
    const root = dom(CREATE);
    const locked = { createGate: { vehicle: { permission: "vehicle:create", granted: false } } };
    applyBindings(root, { source: SOURCE, onAction: fn, gates: locked });
    expect(root.querySelector("button")!.getAttribute("data-locked")).toBeTruthy();

    const granted = { createGate: { vehicle: { permission: "vehicle:create", granted: true } } };
    applyBindings(root, { source: SOURCE, onAction: fn, gates: granted });
    const btn = root.querySelector("button")!;
    expect(btn.getAttribute("data-locked")).toBeNull();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    (btn as HTMLElement).click();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("有权再锁上：点了不发（委托在点击时看 data-locked，不是看绑定时）", () => {
    const fn = vi.fn();
    const root = dom(CREATE);
    const granted = { createGate: { vehicle: { permission: "vehicle:create", granted: true } } };
    const locked = { createGate: { vehicle: { permission: "vehicle:create", granted: false } } };
    applyBindings(root, { source: SOURCE, onAction: fn, gates: granted });
    applyBindings(root, { source: SOURCE, onAction: fn, gates: locked });
    (root.querySelector("button") as HTMLElement).click();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("转移动作（submitWorkflow / approveWorkflow / rejectWorkflow）", () => {
  const ROW_SUBMIT = `
    <table><tbody data-rows="vehicle">
      <tr><td data-field="plate"></td><td><button data-action="submitWorkflow" data-entity="vehicle">提交审批</button></td></tr>
    </tbody></table>`;

  it("行内提交：点了发事件，rowId 是当前行", () => {
    const seen: unknown[] = [];
    const root = dom(ROW_SUBMIT);
    const r = applyBindings(root, {
      source: SOURCE,
      onAction: (e) => seen.push(e),
      gates: { workflowEntities: ["vehicle"] },
    });
    expect(r.problems).toEqual([]);
    (root.querySelector("tbody tr button") as HTMLElement).click();
    expect(seen[0]).toEqual({ kind: "submitWorkflow", entityId: "vehicle", rowId: "v1" });
  });

  it("列表外的转移动作取不到行 → 如实报，不挂监听", () => {
    const fn = vi.fn();
    const root = dom('<button data-action="approveWorkflow" data-entity="vehicle">通过</button>');
    const r = applyBindings(root, { source: SOURCE, onAction: fn });
    (root.querySelector("button") as HTMLElement).click();
    expect(fn).not.toHaveBeenCalled();
    expect(r.problems.some((p) => p.includes("取不到行 id"))).toBe(true);
  });

  it("实体没挂审批流 → 打孔问题，如实点名", () => {
    const root = dom(ROW_SUBMIT);
    const r = applyBindings(root, {
      source: SOURCE,
      gates: { workflowEntities: [] }, // 真的一个都没挂
    });
    expect(r.problems.some((p) => p.includes("没有绑定审批流"))).toBe(true);
  });

  it("宿主没算 workflowEntities（undefined）→ 不校验，别把没算当没挂", () => {
    const root = dom(ROW_SUBMIT);
    const r = applyBindings(root, { source: SOURCE, gates: {} });
    expect(r.problems).toEqual([]);
  });
});

describe("引用不存在的东西要如实报，不许静默", () => {
  it("实体不存在", () => {
    // ⚠ 必须裹 <table>：<tbody>/<tr>/<td> 塞进 <div>.innerHTML 会被解析器直接丢掉
    //   （它们只在表格里合法）。夹具第一版没裹，元素压根不存在，判据看着"不响"，
    //   差点被我当成实现有问题。
    const root = dom('<table><tbody data-rows="不存在"><tr><td data-cell></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("不存在"))).toBe(true);
  });

  it("data-field 不是所在 data-rows 那个实体的字段", () => {
    // 作用域判据：字段是真的，但拿工单表的一行去取客户的字段，
    // 取出来是别人的数据。跟自由树 rowsRef/fieldRef 的树级校验同口径。
    const root = dom(
      '<table><tbody data-rows="vehicle"><tr><td data-field="customer_name"></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("customer_name"))).toBe(true);
  });
});

describe("一个孔都没打的页面不许看起来完美通过", () => {
  it("problems 空 + filled 全 0，但那不代表做完了", () => {
    const root = dom("<div><h1>标题</h1><p>一段字</p></div>");
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems).toEqual([]);            // 没有绑定就没有错误的绑定
    expect(Object.values(r.filled).every((n) => n === 0)).toBe(true);
  });

  it("所以另有 hasAnyDataSource 单独守这一条", () => {
    // 今天在这个形状上栽了五次（调度核 startswith / nav 顺序 / 第4步整页丢 /
    // 第5步可溯率 / 第6步过结构闸）。判据只查"产出的对不对"，
    // 不查"该有的在不在"，就必然漏。
    expect(hasAnyDataSource(dom("<div><h1>死页</h1></div>"))).toBe(false);
    expect(hasAnyDataSource(dom(TABLE))).toBe(true);
  });

  it("data-record 也是数据源——向导/表单不能只认 rows/value/chart", () => {
    expect(
      hasAnyDataSource(
        dom(
          '<form data-record="product"><span data-field="name"></span></form>'
        )
      )
    ).toBe(true);
    expect(
      hasAnyDataSource(
        dom('<button data-action="createRecord" data-entity="product">提交</button>')
      )
    ).toBe(false);
  });
});

describe("enum 字段显标签，不显内部 id", () => {
  /**
   * ⚠ 这组是补的，因为 BindingField.options 头一版写成 `{ value, label }`，
   * 而 formatFieldText 读的是 `o.id`——两边对不上的后果不是报错，是
   * **enum 恒显内部 id**（`music_member` 这种漏到界面上，线上截图逮到过）。
   *
   * 那时唯一的迹象只是 tsc 的一条类型错。而"类型不对但跑得动"正是这个仓
   * 反复栽的形状：页面照渲染、problems 是空的、消毒器照常成功。
   * 所以判据落在**渲染出来的字**上，不落在类型上。
   */
  const SRC: BindingSource = {
    rows: { order: [{ id: "o1", status: "in_transit" }, { id: "o2", status: "unknown_x" }] },
    fields: {
      order: [
        { id: "status", name: "状态", type: "enum",
          options: [{ id: "in_transit", label: "运输中" }, { id: "done", label: "已完成" }] },
      ],
    },
  };

  it("行内 data-field 出中文标签", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SRC });
    const cells = Array.from(root.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells[0]).toBe("运输中");
    expect(r.problems).toEqual([]);
  });

  it("值不在 options 里就如实出原文 —— 不猜、不显空", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    applyBindings(root, { source: SRC });
    const cells = Array.from(root.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells[1]).toBe("unknown_x");
  });

  it("data-cell 展开的单元格走同一条格式化 —— 两条读路不许分叉", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-cell>格</td></tr></tbody></table>');
    applyBindings(root, { source: SRC });
    expect(root.querySelector("tbody tr td")?.textContent).toBe("运输中");
  });

  it("label 缺席时回落 id，不显 undefined", () => {
    const src: BindingSource = {
      rows: { order: [{ id: "o1", status: "in_transit" }] },
      fields: { order: [{ id: "status", type: "enum", options: [{ id: "in_transit" }] }] },
    };
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    applyBindings(root, { source: src });
    expect(root.querySelector("td")?.textContent).toBe("in_transit");
  });
});

/**
 * 单条记录作用域 —— `data-record`（2026-08-15）。
 *
 * 真机（烘焙那趟 gemini-3.5-flash）bind 挂了一页，重问 2 次没改对：
 *
 *     <h4 data-field=product_ref>：写在 data-rows 容器外面——没有「当前行」
 *
 * 那是主从视图右侧的详情面板。病根不是模型不会写，是**契约缺了原语**：
 * 原来只有 data-rows（迭代+作用域焊死）和 data-value（聚合数字），
 * 「显示单条记录的某个字段」压根没有对应的词。
 *
 * 照 petite-vue 的 v-scope 做：它的 v-scope 与 v-for 走同一个
 * createScopedContext（walk.ts:44 / for.ts:105），读字段的指令不关心
 * 作用域从哪来。所以 data-field 保持一个词，不另造 data-record-field。
 */
describe("单条记录作用域", () => {
  it("填的是那一条的字段", () => {
    const root = dom(
      '<div data-record="vehicle"><h4 data-field="plate">示例</h4>' +
        '<span data-field="owner">示例</span></div>'
    );
    const r = applyBindings(root, { source: SOURCE });
    expect(root.querySelector("h4")!.textContent).toBe("京A·11111");
    expect(root.querySelector("span")!.textContent).toBe("张师傅");
    expect(r.problems).toEqual([]);
    expect(r.filled.record).toBe(1);
  });

  it("data-record-id 指定取哪一条", () => {
    const root = dom(
      '<div data-record="vehicle" data-record-id="v3"><h4 data-field="plate">x</h4></div>'
    );
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("h4")!.textContent).toBe("京C·33333");
  });

  it("没写 data-record-id 时读宿主 selected，不是永远第一行", () => {
    const root = dom(
      '<div data-record="vehicle"><h4 data-field="plate">x</h4></div>'
    );
    applyBindings(root, { source: { ...SOURCE, selected: { vehicle: "v2" } } });
    expect(root.querySelector("h4")!.textContent).toBe("京B·22222");
  });

  it("模板写了 data-record-id，盖过宿主 selected", () => {
    const root = dom(
      '<div data-record="vehicle" data-record-id="v3"><h4 data-field="plate">x</h4></div>'
    );
    applyBindings(root, { source: { ...SOURCE, selected: { vehicle: "v2" } } });
    expect(root.querySelector("h4")!.textContent).toBe("京C·33333");
  });

  it("selected 指向已删的行时回落第一条，不报错", () => {
    const root = dom(
      '<div data-record="vehicle"><h4 data-field="plate">x</h4></div>'
    );
    const r = applyBindings(root, {
      source: { ...SOURCE, selected: { vehicle: "gone" } },
    });
    expect(root.querySelector("h4")!.textContent).toBe("京A·11111");
    expect(r.problems).toEqual([]);
  });

  it("动作带得出当前这条的 id", () => {
    const root = dom(
      '<div data-record="vehicle" data-record-id="v2">' +
        '<button data-action="editRecord" data-entity="vehicle">编辑</button></div>'
    );
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("button")!.getAttribute("data-row-id")).toBe("v2");
  });

  /**
   * ⚠ **本组最要紧的一条**。data-record 那一轮如果不跳过 data-rows 内部，
   * 会拿"第一条记录"把每一行都覆盖一遍——**表格里每行变成同一条数据**，
   * 而且没有任何一处报错（填充成功、problems 为空）。
   *
   * petite-vue 靠原型链让内层作用域覆盖外层；我们结构简单，按 closest 判归属。
   */
  it("不许把行内字段覆盖成同一条", () => {
    // ⚠ 危险形状是 data-record **嵌在行模板里**：行被复制 N 份之后，
    //   每一份里都有一个 data-record，后面那轮会拿"第一条"把它们全刷成一样。
    //   ⚠ 第一版这条用例把 data-record 写成表格的**兄弟节点**，
    //     closest("[data-rows]") 本来就是 null——守卫删掉也不红，
    //     变异测试当场逮到。形状不对的判据等于没有判据。
    const root = dom(
      '<table><tbody data-rows="vehicle" data-limit="3">' +
        '<tr><td data-field="plate">x</td>' +
        '<td><div data-record="vehicle"><em data-field="owner">y</em></div></td>' +
        "</tr></tbody></table>"
    );
    applyBindings(root, { source: SOURCE });
    const plates = [...root.querySelectorAll("td[data-field]")].map((c) => c.textContent);
    expect(plates).toEqual(["京A·11111", "京B·22222", "京C·33333"]);
    // 行内那个 data-record 里的字段也该跟着**各自的行**走，不是全变第一条
    const owners = [...root.querySelectorAll("em")].map((c) => c.textContent);
    expect(owners).toEqual(["张师傅", "李师傅", "王师傅"]);
  });

  it("实体不存在时如实报，不静默", () => {
    const root = dom('<div data-record="ghost"><h4 data-field="plate">x</h4></div>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.join()).toContain("ghost");
  });

  it("data-record-id 取不到记录时报错", () => {
    const root = dom(
      '<div data-record="vehicle" data-record-id="nope"><h4 data-field="plate">x</h4></div>'
    );
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.join()).toContain("取不到记录");
  });
});

describe("内层作用域的字段归内层管", () => {
  /**
   * ⚠ 2026-08-16 真机（健身房完整链路）揪出来的：p1/p2 各报 8~9 条
   * 「data-field=date：不是实体 member 的字段」。
   *
   * 形状是 data-record 里套着 data-rows：
   *
   *     <div data-record="member">                会员详情卡
   *       <tbody data-rows="consumption_record">  里面套着消费流水表
   *         <td data-field="date">                它属于 consumption_record
   *
   * fillFields 用的是 scope.querySelectorAll("[data-field]")——抓全部后代，
   * 于是 member 那一轮把内层的字段也认领走了。
   *
   * ⚠ 而 Python 侧 scan_bindings 用**标签栈**，内层天然覆盖外层，判 0 problems。
   *   **两边语义不一致**：判据说没事，运行时报一串。petite-vue 用原型链
   *   实现同样的覆盖，这里按 closest 判归属。
   */
  const source = {
    rows: {
      member: [{ id: "m1", name: "张三" }],
      consumption_record: [
        { id: "c1", date: "2026-01-01" },
        { id: "c2", date: "2026-01-02" },
      ],
    },
    fields: {
      member: [{ id: "name", name: "姓名" }],
      consumption_record: [{ id: "date", name: "日期" }],
    },
  };

  function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("record 里套 rows：内层字段不被外层认领", () => {
    const root = mount(`
      <div data-record="member">
        <h4 data-field="name">占位</h4>
        <table><tbody data-rows="consumption_record">
          <tr><td data-field="date">占位</td></tr>
        </tbody></table>
      </div>`);
    const report = applyBindings(root, { source });
    expect(report.problems).toEqual([]);
    expect(root.querySelector("h4")!.textContent).toBe("张三");
  });

  it("内层 rows 照常按记录克隆", () => {
    const root = mount(`
      <div data-record="member">
        <span data-field="name">占位</span>
        <table><tbody data-rows="consumption_record">
          <tr><td data-field="date">占位</td></tr>
        </tbody></table>
      </div>`);
    applyBindings(root, { source });
    expect(root.querySelectorAll("tbody tr").length).toBe(2);
    expect(root.querySelectorAll("tbody td")[0].textContent).toBe("2026-01-01");
    expect(root.querySelectorAll("tbody td")[1].textContent).toBe("2026-01-02");
  });

  it("直属字段仍然要填（别把该填的也跳过）", () => {
    const root = mount(`
      <div data-record="member">
        <div class="wrap"><span data-field="name">占位</span></div>
      </div>`);
    const report = applyBindings(root, { source });
    expect(report.problems).toEqual([]);
    expect(root.querySelector("span")!.textContent).toBe("张三");
  });
});

describe("作用域自己也算在内", () => {
  /**
   * ⚠ 真机（健身房 p4）：行模板的**根节点自己**带着 data-action —
   *
   *     <div data-rows="lesson_bill">
   *       <div data-action="openRecord" data-entity="lesson_bill">   ← 行根节点
   *
   * querySelectorAll 只找后代，于是行 id 没打上，12 个动作全报
   * 「取不到行 id，不挂监听」——**整块列表点不动**，而 Python 判据看嵌套判 0 条。
   */
  const source = {
    rows: { bill: [{ id: "b1", no: "A-1" }, { id: "b2", no: "A-2" }] },
    fields: { bill: [{ id: "no", name: "单号" }] },
  };

  function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("动作在行根节点上也要打上行 id", () => {
    const root = mount(
      '<div data-rows="bill">' +
        '<div data-action="openRecord" data-entity="bill"><span data-field="no">x</span></div>' +
        "</div>"
    );
    const report = applyBindings(root, { source });
    expect(report.problems).toEqual([]);
    const ids = [...root.querySelectorAll("[data-action]")].map((el) =>
      el.getAttribute("data-row-id")
    );
    expect(ids).toEqual(["b1", "b2"]);
  });

  it("字段在作用域根节点上也要填", () => {
    const root = mount('<div data-record="bill" data-field="no">占位</div>');
    applyBindings(root, { source });
    expect(root.firstElementChild!.textContent).toBe("A-1");
  });

  it("后代上的动作照旧（别把老行为改没）", () => {
    const root = mount(
      '<div data-rows="bill"><div><button data-action="openRecord" data-entity="bill">开</button>' +
        '<span data-field="no">x</span></div></div>'
    );
    applyBindings(root, { source });
    const ids = [...root.querySelectorAll("button")].map((el) => el.getAttribute("data-row-id"));
    expect(ids).toEqual(["b1", "b2"]);
  });
});

describe("甘特装饰不是行模板", () => {
  /**
   * ⚠ 2026-08-31 会聚通 p1：data-rows 的第一个子元素是绝对定位的
   * 「当前时间线」，真正的房间行排第二。旧挑选 `tr || firstElementChild`
   * 把红线缓存成模板，innerHTML="" 之后按实体数克隆 N 条红线，
   * 启明星那一行被擦掉。页脚 count=6 是真的，用户看见的是一块白。
   *
   * 变异：把 pickRowTemplate 改回 firstElementChild，本条必红——
   * 房间名一条都没有，now-line 变成 6 条。
   */
  const source: BindingSource = {
    rows: {
      meeting_room: [
        { id: "r1", name: "3F · 启明星" },
        { id: "r2", name: "3F · 天工阁" },
        { id: "r3", name: "2F · 极客吧" },
        { id: "r4", name: "2F · 思享汇" },
        { id: "r5", name: "4F · 创客空间" },
        { id: "r6", name: "4F · 聚贤厅" },
      ],
    },
    fields: { meeting_room: [{ id: "name", name: "名称" }] },
  };

  const GANTT = `
    <div class="relative" data-rows="meeting_room">
      <div class="absolute top-0 bottom-0 left-[22.9%] w-[2px] bg-rose-500 pointer-events-none" data-now-line></div>
      <div class="h-14 flex items-stretch">
        <span data-field="name">3F · 启明星</span>
      </div>
    </div>`;

  it("now-line 在第一子节点时仍展开实体行", () => {
    const root = dom(GANTT);
    const report = applyBindings(root, { source });
    expect(report.problems).toEqual([]);
    const box = root.querySelector("[data-rows]")!;
    const names = [...box.querySelectorAll("[data-field='name']")].map((el) => el.textContent);
    expect(names).toEqual([
      "3F · 启明星",
      "3F · 天工阁",
      "2F · 极客吧",
      "2F · 思享汇",
      "4F · 创客空间",
      "4F · 聚贤厅",
    ]);
    expect(box.querySelectorAll(".h-14")).toHaveLength(6);
    expect(box.querySelectorAll("[data-now-line]")).toHaveLength(1);
  });

  it("反向：不许把 now-line 克隆成 N 条冒充行", () => {
    const root = dom(GANTT);
    applyBindings(root, { source });
    const box = root.querySelector("[data-rows]")!;
    expect(box.querySelectorAll("[data-now-line]").length).not.toBe(6);
    expect(box.querySelector("[data-now-line]")?.classList.contains("absolute")).toBe(true);
  });

  it("再 bind 一次不叠 now-line、行数仍对", () => {
    const root = dom(GANTT);
    applyBindings(root, { source });
    applyBindings(root, { source });
    const box = root.querySelector("[data-rows]")!;
    expect(box.querySelectorAll(".h-14")).toHaveLength(6);
    expect(box.querySelectorAll("[data-now-line]")).toHaveLength(1);
    expect(box.querySelector("[data-field='name']")!.textContent).toBe("3F · 启明星");
  });

  it("tbody 的 tr 仍按行数展开（别把表路径改坏）", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});

describe("货架上的图不是行模板", () => {
  /**
   * ⚠ 2026-09-01 幼儿作息：素材栏抽出 6 张 Unsplash，画面上没了。
   * 源 HTML 还在；data-rows 打在货架容器上，applyBindings innerHTML=""
   * 再按实体数克隆第一项——N=0 清空，N=2 只剩第一张的复印件。
   *
   * 对照 petite-vue v-for / Alpine x-for：循环打在项上，父容器不清空。
   * 变异：删掉 isStaticGallery 那一岔、货架再走 innerHTML=""，本条必红。
   */
  const URLS = [
    "https://images.unsplash.com/photo-a",
    "https://images.unsplash.com/photo-b",
    "https://images.unsplash.com/photo-c",
    "https://images.unsplash.com/photo-d",
  ];
  const SHELF = `
    <div class="grid grid-cols-2" data-rows="photo">
      <figure><img src="${URLS[0]}" alt="一"><figcaption data-field="title">一</figcaption></figure>
      <figure><img src="${URLS[1]}" alt="二"><figcaption data-field="title">二</figcaption></figure>
      <figure><img src="${URLS[2]}" alt="三"><figcaption data-field="title">三</figcaption></figure>
      <figure><img src="${URLS[3]}" alt="四"><figcaption data-field="title">四</figcaption></figure>
    </div>`;
  const photos: BindingSource = {
    rows: {
      photo: [
        { id: "p1", title: "晨起" },
        { id: "p2", title: "午休" },
      ],
    },
    fields: { photo: [{ id: "title", name: "标题" }] },
  };

  function srcs(root: HTMLElement): string[] {
    return [...root.querySelectorAll("img")].map((el) => el.getAttribute("src") || "");
  }

  it("4 张不同 src 的图，bind 之后还在，不许收成第一张的复印件", () => {
    const root = dom(SHELF);
    const report = applyBindings(root, { source: photos });
    expect(report.problems).toEqual([]);
    expect(srcs(root)).toEqual(URLS);
    expect(root.querySelectorAll("img")).toHaveLength(4);
    expect(root.querySelectorAll("img")).not.toHaveLength(2);
  });

  it("实体 0 行也不许把货架清空", () => {
    const root = dom(SHELF);
    applyBindings(root, {
      source: { rows: { photo: [] }, fields: photos.fields },
    });
    expect(srcs(root)).toEqual(URLS);
  });

  it("反向：不许克隆第一张冒充货架", () => {
    const root = dom(SHELF);
    applyBindings(root, { source: photos });
    const got = srcs(root);
    expect(got.filter((s) => s === URLS[0]).length).toBe(1);
    expect(got).not.toEqual([URLS[0], URLS[0]]);
  });

  it("标题叶子照旧填，图还在", () => {
    const root = dom(SHELF);
    applyBindings(root, { source: photos });
    const caps = [...root.querySelectorAll("figcaption")].map((el) => el.textContent);
    expect(caps.slice(0, 2)).toEqual(["晨起", "午休"]);
    expect(root.querySelector("img")?.getAttribute("src")).toBe(URLS[0]);
  });

  it("data-field 打在含 img 的父节点上，不许 textContent 把图抹掉", () => {
    const root = dom(`
      <div data-record="photo" data-record-id="p1">
        <figure data-field="title">
          <img src="${URLS[0]}" alt="一">
          <figcaption>旧标题</figcaption>
        </figure>
      </div>`);
    applyBindings(root, { source: photos });
    expect(root.querySelector("img")?.getAttribute("src")).toBe(URLS[0]);
    expect(root.querySelector("figcaption")?.textContent).toBe("晨起");
  });

  it("再 bind 一次不丢图、不叠图", () => {
    const root = dom(SHELF);
    applyBindings(root, { source: photos });
    applyBindings(root, { source: photos });
    expect(srcs(root)).toEqual(URLS);
  });

  it("一张模板卡仍按行数展开（别把列表路径改坏）", () => {
    const root = dom(`
      <div data-rows="vehicle">
        <article><img src="https://example.com/car.jpg"><span data-field="plate">x</span></article>
      </div>`);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("article")).toHaveLength(3);
    expect(root.querySelectorAll("img")).toHaveLength(3);
  });

  it("tbody 两张示例图仍按行展开，不冻成货架", () => {
    const root = dom(`
      <table><tbody data-rows="vehicle">
        <tr><td><img src="https://example.com/a.jpg"><span data-field="plate">x</span></td></tr>
        <tr><td><img src="https://example.com/b.jpg"><span data-field="plate">y</span></td></tr>
      </tbody></table>`);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("data-rows 包一层 grid 再放 4 张图，0 行也不许清空", () => {
    const root = dom(`
      <section data-rows="photo">
        <h2>成长</h2>
        <div class="grid grid-cols-2">
          <img src="${URLS[0]}" alt="一">
          <img src="${URLS[1]}" alt="二">
          <img src="${URLS[2]}" alt="三">
          <img src="${URLS[3]}" alt="四">
        </div>
      </section>`);
    applyBindings(root, {
      source: { rows: { photo: [] }, fields: photos.fields },
    });
    expect(srcs(root)).toEqual(URLS);
  });

  it("收银台：data-rows 包 grid、只有一张模板卡 → 卡进格子，不复印网格", () => {
    /**
     * ⚠ 2026-09-07 烘焙坊：孔打在滚动层，里面 grid-cols-4 只有一张卡。
     * 旧逻辑克隆 12 份网格，每份一卡 → 一列卡、右边空三列。
     * 变异：rowsHost 不下移到 grid，下面 grid 数量变成 2、class 丢。
     */
    const root = dom(`
      <div class="flex-1 overflow-y-auto" data-rows="product">
        <div class="grid grid-cols-4 gap-3.5">
          <article>
            <h3 data-field="product_name">样板吐司</h3>
            <span data-field="price">0</span>
          </article>
        </div>
      </div>`);
    applyBindings(root, {
      source: {
        rows: {
          product: [
            { id: "a", product_name: "日式北海道奶油吐司", price: 22 },
            { id: "b", product_name: "法式经典原味牛角颂", price: 12 },
          ],
        },
        fields: {
          product: [
            { id: "product_name", name: "成品名" },
            { id: "price", name: "售价", type: "number" },
          ],
        },
      },
    });
    expect(root.querySelectorAll(".grid").length).toBe(1);
    expect(root.querySelector(".grid")?.className).toContain("grid-cols-4");
    const names = [...root.querySelectorAll("[data-field='product_name']")].map(
      el => el.textContent
    );
    expect(names).toEqual(["日式北海道奶油吐司", "法式经典原味牛角颂"]);
    expect(root.textContent).not.toContain("样板吐司");
  });
});

describe("收银台点得动：货架进车、车不是整张商品表", () => {
  const PAGE = `
    <div data-rows="product">
      <div class="grid grid-cols-4">
        <article>
          <h3 data-field="product_name">样板</h3>
        </article>
      </div>
    </div>
    <div>
      <button>清空购物车</button>
      <div class="space-y-3" data-rows="product" data-view="cart">
        <div>
          <h4 data-field="product_name">样板</h4>
          <div>
            <button>-</button>
            <span>1</span>
            <button>+</button>
          </div>
        </div>
      </div>
      <button>立即结算</button>
    </div>`;
  const source: BindingSource = {
    rows: {
      product: [
        { id: "a", product_name: "日式北海道奶油吐司" },
        { id: "b", product_name: "法式经典原味牛角颂" },
      ],
    },
    fields: { product: [{ id: "product_name", name: "成品名" }] },
    cartRows: {
      product: [{ id: "a", product_name: "日式北海道奶油吐司", qty: 2 }],
    },
  };

  it("货架两件、购物车只有已点的那件", () => {
    const root = dom(PAGE);
    applyBindings(root, { source });
    const grids = root.querySelector(".grid")!;
    const cart = root.querySelector(".space-y-3")!;
    expect(grids.querySelectorAll("[data-field='product_name']")).toHaveLength(2);
    expect(cart.querySelectorAll("[data-field='product_name']")).toHaveLength(1);
    expect(cart.textContent).toContain("日式北海道奶油吐司");
    expect(cart.textContent).not.toContain("牛角");
    expect(cart.querySelector("[data-row-id='a']")).toBeTruthy();
  });

  it("点货架（有购物车同伴）→ addToCart；没打孔的「结算」文案不认", () => {
    const root = dom(PAGE);
    applyBindings(root, { source });
    const card = root.querySelector(".grid [data-row-id]") as HTMLElement;
    expect(implicitActionFromClick(card, root)).toEqual({
      kind: "addToCart",
      entityId: "product",
      rowId: card.getAttribute("data-row-id"),
    });
    const pay = [...root.querySelectorAll("button")].find(b =>
      (b.textContent || "").includes("结算")
    )!;
    expect(implicitActionFromClick(pay, root)).toBeNull();
  });

  it("data-filter 芯片筛货架；data-value count 写真件数", () => {
    const root = dom(`
      ${PAGE}
      <button data-filter="product" data-match="*">全部商品 (<span data-value="product" data-aggregate="count">48</span>)</button>
      <button data-filter="product" data-match="吐司">吐司 (<span data-value="product" data-aggregate="count" data-match="吐司">8</span>)</button>`);
    applyBindings(root, {
      source: {
        ...source,
        catalogChip: { product: "吐司" },
      },
    });
    const gridNames = [
      ...root.querySelectorAll(".grid [data-field='product_name']"),
    ].map(el => el.textContent);
    expect(gridNames.every(n => (n || "").includes("吐司"))).toBe(true);
    expect(gridNames.join()).not.toContain("牛角");
    expect(root.textContent).toContain("全部商品 (2)");
    expect(root.textContent).toContain("吐司 (1)");
    expect(root.textContent).not.toContain("(48)");
    expect(
      implicitActionFromClick(root.querySelector("[data-match='吐司']"), root)
    ).toEqual({
      kind: "filterCatalog",
      entityId: "product",
      rowId: null,
      chip: "吐司",
    });
  });

  it("data-value + data-view=cart 的合计 = 单价×数量，没打孔的 ¥67 不许改", () => {
    const root = dom(`
      ${PAGE}
      <span data-value="product" data-aggregate="sum" data-field="price" data-view="cart">0</span>
      <span class="dead">¥ 67.00</span>`);
    applyBindings(root, {
      source: {
        ...source,
        cartRows: {
          product: [
            {
              id: "a",
              product_name: "日式北海道奶油吐司",
              price: 22,
              qty: 2,
            },
          ],
        },
      },
    });
    expect(
      root.querySelector("[data-view='cart'][data-aggregate='sum']")?.textContent
    ).toBe("44");
    expect(root.querySelector(".dead")?.textContent).toBe("¥ 67.00");
  });

  it("filterCatalogRows 搜索子串", () => {
    const rows = [
      { id: "a", product_name: "日式北海道奶油吐司" },
      { id: "b", product_name: "法式经典原味牛角颂" },
    ];
    expect(filterCatalogRows(rows, "牛角", "").map(r => r.id)).toEqual(["b"]);
    expect(filterCatalogRows(rows, "", "*").map(r => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("stampRowId 不许用 instanceof HTMLElement（iframe 另一份 realm）", () => {
    const src = runtimeSrc();
    const start = src.indexOf("function stampRowId");
    const next = src.indexOf("function ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("setAttribute(\"data-row-id\"");
    expect(body).not.toContain("instanceof");
  });

  it("运行时路径不许再猜应收总计/招牌/拼音（孔没打就不改）", () => {
    const src = runtimeSrc();
    expect(src).not.toContain("应收总计");
    expect(src).not.toContain("拼音");
    expect(src).not.toContain("招牌");
  });

  it("catalogQuery 滤货架；没打 data-search 的输入框不认", () => {
    const root = dom(`
      ${PAGE}
      <input placeholder="拼音 / 名称">
      <input data-search="product" placeholder="搜">`);
    applyBindings(root, {
      source: { ...source, catalogQuery: { product: "牛角" } },
    });
    const names = [
      ...root.querySelectorAll(".grid [data-field='product_name']"),
    ].map(el => el.textContent);
    expect(names.join()).toContain("牛角");
    expect(names.join()).not.toContain("吐司");
    expect(findCatalogSearchInput(root)?.getAttribute("data-search")).toBe(
      "product"
    );
  });

  it("data-action 购物车四种：行内带 rowId，页头不要行；没打孔的文案不发", () => {
    const seen: unknown[] = [];
    const root = dom(`
      <div data-rows="product">
        <article>
          <h3 data-field="product_name">样板</h3>
          <button data-action="addToCart" data-entity="product">加入</button>
          <button data-action="adjustCartQty" data-entity="product" data-delta="-1">-</button>
        </article>
      </div>
      <button data-action="clearCart" data-entity="product">清空</button>
      <button data-action="checkout" data-entity="product">结算</button>
      <button>立即结算</button>`);
    applyBindings(root, {
      source: {
        rows: { product: [{ id: "a", product_name: "吐司" }] },
        fields: { product: [{ id: "product_name", name: "名" }] },
      },
      onAction: e => seen.push(e),
    });
    (root.querySelector("[data-action='addToCart']") as HTMLElement).click();
    (root.querySelector("[data-action='adjustCartQty']") as HTMLElement).click();
    (root.querySelector("[data-action='clearCart']") as HTMLElement).click();
    (root.querySelector("[data-action='checkout']") as HTMLElement).click();
    const unlabeled = [...root.querySelectorAll("button")].find(
      b => (b.textContent || "").trim() === "立即结算"
    )!;
    unlabeled.click();
    expect(seen).toEqual([
      { kind: "addToCart", entityId: "product", rowId: "a" },
      { kind: "adjustCartQty", entityId: "product", rowId: "a", delta: -1 },
      { kind: "clearCart", entityId: "product", rowId: null },
      { kind: "checkout", entityId: "product", rowId: null },
    ]);
  });

  it("重复 applyBindings 页头按钮只发一次（搜索 bindNow 同一纪律）", () => {
    const fn = vi.fn();
    const root = dom(
      '<button data-action="checkout" data-entity="vehicle">结算</button>'
    );
    applyBindings(root, { source: SOURCE, onAction: fn });
    applyBindings(root, { source: SOURCE, onAction: fn });
    applyBindings(root, { source: SOURCE, onAction: fn });
    (root.querySelector("button") as HTMLElement).click();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("data-view=cart 优先于结构猜测（grid 默认当货架）", () => {
    const root = dom(`
      <div data-rows="product" data-view="cart" class="grid grid-cols-2">
        <article><h3 data-field="product_name">样板</h3></article>
      </div>
      <div data-rows="product" class="grid grid-cols-4">
        <article><h3 data-field="product_name">样板</h3></article>
      </div>`);
    applyBindings(root, { source });
    expect(root.querySelector("[data-view='cart']")?.textContent).toContain(
      "日式北海道奶油吐司"
    );
    expect(root.querySelector("[data-view='cart']")?.textContent).not.toContain(
      "牛角"
    );
    expect(root.querySelector(".grid-cols-4")?.textContent).toContain("牛角");
    expect(root.querySelector(".grid-cols-4")?.textContent).toContain("吐司");
  });
});

describe("矩阵时间块不是第一行的复印件", () => {
  /**
   * ⚠ 2026-09-01 会席宝今日排期：静态页每间会议室日程不同，「已接数据」
   * 一亮，时间块全变成第一行的复印件。顶栏说填了几十处，用户以为数据
   * 源写错了。日历 / 排期 / 甘特 / 矩阵都会这样。
   *
   * 绑洞提示词「只留一行」把另外七间的块删掉之后，运行时 innerHTML=""
   * 再克隆第一行——房间名对了，会议是复印件。
   *
   * 对照：
   *   · petite-vue v-for（for.ts）指令打在项上，parent.removeChild(模板)，
   *     从不清空父容器；
   *   · Alpine x-for 同口径，兄弟节点不动；
   *   · FullCalendar resource timeline：资源行和事件是两份数据，
   *     事件不写进资源行模板里跟着 clone。
   *
   * 变异：删掉 applyBindings 里 paintedItems 就地填那一岔，三行走克隆，
   * 再被 strip 剥块，会议全空（本条 equal 必红）。
   * 变异：删掉 stripUnboundLaneChips，单行模板必复印成 N 份 Q2。
   */
  const rooms: BindingSource = {
    rows: {
      meeting_room: [
        { id: "r1", name: "2F · 松风阁" },
        { id: "r2", name: "3F · 启明星" },
        { id: "r3", name: "3F · 天工阁" },
      ],
    },
    fields: { meeting_room: [{ id: "name", name: "名称" }] },
  };

  const MATRIX = `
    <div class="relative" data-rows="meeting_room">
      <div class="h-[68px] flex relative">
        <span data-field="name">2F · 松风阁</span>
        <div class="absolute top-2 left-[10%]">Q2 行政与资产盘点会</div>
      </div>
      <div class="h-[68px] flex relative">
        <span data-field="name">3F · 启明星</span>
        <div class="absolute top-2 left-[40%]">华东供应链对接沟通</div>
      </div>
      <div class="h-[68px] flex relative">
        <span data-field="name">3F · 天工阁</span>
        <div class="absolute top-2 left-[20%]">面试：产品经理</div>
      </div>
    </div>`;

  function chipTexts(root: HTMLElement): string[] {
    return [...root.querySelectorAll(".absolute")]
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean);
  }

  it("多行且时间块文案不同，bind 之后各行自己的会议还在，不许收成第一行复印件", () => {
    const root = dom(MATRIX);
    const report = applyBindings(root, { source: rooms });
    expect(report.problems).toEqual([]);
    const chips = chipTexts(root);
    expect(chips).toEqual([
      "Q2 行政与资产盘点会",
      "华东供应链对接沟通",
      "面试：产品经理",
    ]);
    expect(chips.filter((t) => t === "Q2 行政与资产盘点会")).toHaveLength(1);
  });

  it("反向：不许把第一行会议复印到每一行", () => {
    const root = dom(MATRIX);
    applyBindings(root, { source: rooms });
    expect(chipTexts(root)).not.toEqual([
      "Q2 行政与资产盘点会",
      "Q2 行政与资产盘点会",
      "Q2 行政与资产盘点会",
    ]);
  });

  it("房间名照旧填，时间块还在原行", () => {
    const root = dom(MATRIX);
    applyBindings(root, { source: rooms });
    const names = [...root.querySelectorAll("[data-field='name']")].map(
      (el) => el.textContent
    );
    expect(names).toEqual(["2F · 松风阁", "3F · 启明星", "3F · 天工阁"]);
  });

  it("再 bind 一次不丢块、不叠块", () => {
    const root = dom(MATRIX);
    applyBindings(root, { source: rooms });
    applyBindings(root, { source: rooms });
    expect(chipTexts(root)).toEqual([
      "Q2 行政与资产盘点会",
      "华东供应链对接沟通",
      "面试：产品经理",
    ]);
  });

  it("单行模板仍按房间数展开，但不许把示例会议复印 N 份", () => {
    const root = dom(`
      <div class="relative" data-rows="meeting_room">
        <div class="h-[68px] flex relative">
          <span data-field="name">2F · 松风阁</span>
          <div class="absolute top-2 left-[10%]">Q2 行政与资产盘点会</div>
        </div>
      </div>`);
    applyBindings(root, { source: rooms });
    expect(root.querySelectorAll("[data-field='name']")).toHaveLength(3);
    expect(root.querySelector("[data-field='name']")!.textContent).toBe(
      "2F · 松风阁"
    );
    expect(chipTexts(root).filter((t) => t === "Q2 行政与资产盘点会")).toHaveLength(
      0
    );
  });

  it("tbody 两行示例仍按行展开，不冻成矩阵", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("单行模板展开剥示例会议，now-line 兄弟还在、不许跟着复印", () => {
    const root = dom(`
      <div class="relative" data-rows="meeting_room">
        <div class="absolute top-0 bottom-0 left-[22.9%] w-[2px] pointer-events-none" data-now-line>现在 14:35</div>
        <div class="h-[68px] flex relative">
          <span data-field="name">2F · 松风阁</span>
          <div class="absolute top-2 left-[10%]">Q2 行政与资产盘点会</div>
          <div class="absolute top-2 left-[40%]">华东供应链对接沟通</div>
        </div>
      </div>`);
    applyBindings(root, { source: rooms });
    expect(root.querySelectorAll("[data-field='name']")).toHaveLength(3);
    expect(chipTexts(root).filter((t) => t.includes("Q2"))).toHaveLength(0);
    expect(root.querySelectorAll("[data-now-line]")).toHaveLength(1);
    expect(root.querySelector("[data-now-line]")!.textContent).toContain("14:35");
  });

  it("applyBindings 真调用 paintedItems / stripUnboundLaneChips（别只写了函数）", () => {
    const src = runtimeSrc();
    const start = src.indexOf("export function applyBindings");
    const next = src.indexOf("export function", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("paintedItems(");
    expect(body).toContain("stripUnboundLaneChips(");
  });
});

describe("P3-① 卡片台账不是货架", () => {
  /**
   * ⚠ 执行单 P3-①：isStaticGallery 把「非表格 + ≥2 张不同图」认成画廊，
   * 卡片式台账（每张卡头像/封面 + 多个 data-field）静默截成货架，且不进
   * problems。变异：删 looksLikeCardLedger 那一岔，下面必红。
   */
  const BOOKS: BindingSource = {
    rows: {
      book: [
        { id: "b1", title: "借还须知", author: "馆员甲" },
        { id: "b2", title: "开馆时间", author: "馆员乙" },
        { id: "b3", title: "热门书单", author: "馆员丙" },
      ],
    },
    fields: {
      book: [
        { id: "title", name: "书名" },
        { id: "author", name: "作者" },
      ],
    },
  };

  const CARDS = `
    <div class="grid grid-cols-2" data-rows="book">
      <article>
        <img src="https://images.example/cover-a.jpg" alt="">
        <h3 data-field="title">示例书</h3>
        <p data-field="author">示例作者</p>
      </article>
      <article>
        <img src="https://images.example/cover-b.jpg" alt="">
        <h3 data-field="title">另一本</h3>
        <p data-field="author">另一个人</p>
      </article>
    </div>`;

  it("两张不同封面的卡按实体行数展开，不许冻成两张货架", () => {
    const root = dom(CARDS);
    const report = applyBindings(root, { source: BOOKS });
    expect(report.problems).toEqual([]);
    expect(root.querySelectorAll("article")).toHaveLength(3);
    const titles = [...root.querySelectorAll("[data-field='title']")].map(
      (el) => el.textContent
    );
    expect(titles).toEqual(["借还须知", "开馆时间", "热门书单"]);
    expect(root.querySelectorAll("img")).toHaveLength(3);
  });

  it("反向：真货架（每项只有图+一条说明）仍不许收成第一张复印件", () => {
    const root = dom(`
      <div class="grid" data-rows="photo">
        <figure><img src="https://images.unsplash.com/photo-a" alt=""><figcaption data-field="title">一</figcaption></figure>
        <figure><img src="https://images.unsplash.com/photo-b" alt=""><figcaption data-field="title">二</figcaption></figure>
      </div>`);
    applyBindings(root, {
      source: {
        rows: { photo: [{ id: "p1", title: "晨起" }, { id: "p2", title: "午休" }] },
        fields: { photo: [{ id: "title", name: "标题" }] },
      },
    });
    expect(root.querySelectorAll("img")).toHaveLength(2);
    expect(
      [...root.querySelectorAll("img")].map((el) => el.getAttribute("src"))
    ).toEqual([
      "https://images.unsplash.com/photo-a",
      "https://images.unsplash.com/photo-b",
    ]);
  });

  it("通电：isStaticGallery 必须先问 looksLikeCardLedger", () => {
    const src = runtimeSrc();
    const start = src.indexOf("function isStaticGallery");
    const next = src.indexOf("function ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("looksLikeCardLedger(box)");
    expect(body).toContain("return false");
  });
});

describe("P3-② 有图的孔不写进渐变遮罩", () => {
  /**
   * ⚠ 执行单 P3-②：setFieldText 选中第一个空后代（选择器曾含 div），
   * 卡片里通常是渐变遮罩；无空叶子时值被丢但 filled.field 照加。
   * 变异：把 div 加回文字叶子选择器，或写不上仍 filled.field++，下面必红。
   */
  const SRC: BindingSource = {
    rows: { book: [{ id: "b1", title: "开馆时间" }] },
    fields: { book: [{ id: "title", name: "书名" }] },
  };

  it("只有遮罩 div 时值不许写上，filled.field 不许假装成功", () => {
    const root = dom(`
      <div data-record="book" data-record-id="b1">
        <div data-field="title">
          <img src="https://images.example/cover.jpg" alt="">
          <div class="absolute inset-0 bg-gradient-to-t"></div>
        </div>
      </div>`);
    const report = applyBindings(root, { source: SRC });
    expect(root.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/cover.jpg"
    );
    expect(root.querySelector(".absolute")?.textContent).toBe("");
    expect(report.filled.field).toBe(0);
    expect(report.problems.some((p) => p.includes("可写文字叶子"))).toBe(true);
  });

  it("有 span 叶子就写进 span，遮罩仍空", () => {
    const root = dom(`
      <div data-record="book" data-record-id="b1">
        <div data-field="title">
          <img src="https://images.example/cover.jpg" alt="">
          <span>占位</span>
          <div class="absolute inset-0 bg-gradient-to-t"></div>
        </div>
      </div>`);
    const report = applyBindings(root, { source: SRC });
    expect(root.querySelector("span")?.textContent).toBe("开馆时间");
    expect(root.querySelector(".absolute")?.textContent).toBe("");
    expect(report.filled.field).toBe(1);
    expect(report.problems).toEqual([]);
  });

  it("反向：文字叶子选择器不许再含裸 div", () => {
    const src = runtimeSrc();
    const start = src.indexOf("function setFieldText");
    const next = src.indexOf("function ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toContain('"span, p, figcaption, h1, h2, h3, h4, h5, h6, time, em, strong, small, label, a"');
    expect(body).not.toContain("label, a, div");
    expect(body).toContain("return false");
    expect(src).toContain("可写文字叶子");
  });
});

describe("闭环空、版本史有模型时孔能填上（2026-09-07 烘焙坊）", () => {
  /**
   * 真机形状：页面 HTML 带 data-rows、样板字还在、publishClosure 空。
   * 只走前两源 → BindingSource 没有实体 → 解释器早退、样板不改、filled=0。
   * 接上第三源 + 种子 → 表格按行克隆，样板字被换掉。
   *
   * 变异：deriveSettledFiveSystemModel 不再读 versionHistory，下面必红。
   */
  const BAKERY_HTML = `
    <table>
      <tbody data-rows="product">
        <tr>
          <td data-field="product_name">样板吐司</td>
          <td data-field="price">0</td>
        </tr>
      </tbody>
    </table>`;
  const SNAP = {
    id: "mv-1",
    model: {
      datamodel: {
        entities: [
          {
            id: "product",
            name: "成品",
            fields: [
              { id: "product_name", name: "品名", type: "string" },
              { id: "price", name: "售价", type: "number" },
            ],
          },
        ],
      },
    },
  };

  it("不读版本史：样板还在，filled 为 0", () => {
    const model = deriveSettledFiveSystemModel({}, undefined);
    expect(model).toBeNull();
    const root = dom(BAKERY_HTML);
    const r = applyBindings(root, {
      source: deriveBindingSource(model, null),
    });
    expect(r.filled.field).toBe(0);
    expect(r.filled.rows).toBe(0);
    expect(root.textContent).toContain("样板吐司");
    expect(r.problems.some((p) => p.includes("product"))).toBe(true);
  });

  it("读版本史并铺种子：样板被换掉，filled > 0", () => {
    const model = deriveSettledFiveSystemModel({}, undefined, {
      versions: [SNAP],
      currentId: "mv-1",
    });
    expect(model?.datamodel?.entities?.[0].id).toBe("product");
    const seeded = seedRuntimeState(
      initRuntimeState(model),
      model,
      Date.UTC(2026, 8, 7)
    );
    const source = deriveBindingSource(model, seeded);
    expect(source.rows.product.length).toBeGreaterThan(0);
    const root = dom(BAKERY_HTML);
    const r = applyBindings(root, { source });
    expect(r.filled.rows).toBeGreaterThan(0);
    expect(r.filled.field).toBeGreaterThan(0);
    expect(root.textContent).not.toContain("样板吐司");
    expect(r.problems).toEqual([]);
  });
});

