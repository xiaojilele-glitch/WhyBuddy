/**
 * 五系统模型 + 运行时状态 → 解释器要的 `BindingSource`。
 *
 * ## 这是整条 HTML 载体链路最后一个没接通的环节
 *
 * 第 6.5 步在页面上打好了 `data-*` 孔，解释器也写好了填数逻辑，可**全仓没有
 * 一处产出 `{rows, fields}`**——于是 `bound` 恒为 false，页面上永远是模型编的
 * 占位文字。孔在、手在、线没穿过去。
 *
 * ## 不新造数据来源
 *
 * 行数据就用老区块运行时那一份（`RuntimeState.entities`，含 demo-seed 的示例
 * 行、用户写入的真实行、以及"写了真实数据就整批清掉示例"那套语义）。
 * 两条渲染路径读同一份数据，是"只迭代业务逻辑模型就能无限迭代"这句话在
 * 运行时的落点——各读各的等于同一个应用有两份互不相干的数据。
 *
 * ⚠ 行的形状要**摊平**：RuntimeRow 是 `{id, values:{...}}`，而解释器按
 * `row[fieldId]` 取。不摊平的话每个格子都取到 undefined，页面填出一片「—」，
 * 而 problems 是空的（孔都认得出，只是值没有）——又一个不报错的失效。
 */

import type { RuntimeRow, RuntimeState } from "./live-runtime";
import type { BindingField, BindingRow, BindingSource } from "./html-binding-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

export const BINDING_SOURCE_VERSION = "derive-binding-source-v1";

/** RuntimeRow → 解释器要的平铺行。id 单独提出来（rowIdField 默认取 "id"）。 */
function flatten(row: RuntimeRow): BindingRow {
  return { ...(row.values || {}), id: row.id };
}

/**
 * 组装。模型缺席 / 实体为空时返回空源——**不编数据**。
 *
 * 空源之下解释器会如实报 problems（"模型里没有这个实体"），那正是该看见的：
 * 页面引用了一个不存在的实体，是模型的问题，不该被一份假数据盖住。
 */
export function deriveBindingSource(
  model: FiveSystemModel | null | undefined,
  runtime: RuntimeState | null | undefined
): BindingSource {
  const rows: Record<string, BindingRow[]> = {};
  const fields: Record<string, BindingField[]> = {};
  const cartRows: Record<string, BindingRow[]> = {};

  for (const entity of model?.datamodel?.entities ?? []) {
    if (!entity?.id) continue;
    fields[entity.id] = (entity.fields ?? [])
      .filter(f => f?.id)
      .map(f => ({
        id: f.id,
        name: f.name || f.id,
        type: f.type,
        format: f.format,
        // ⚠ FieldOption 已经是 {id,label}，跟 BindingField.options 同形。
        //   这里**不做键名转换**——转换过一次就有了两份词汇，而这正是
        //   `{value,label}` 那个 bug 的来源（enum 恒显内部 id）。
        options: f.options?.map(o => ({ id: o.id, label: o.label })),
      }));
    const table = (runtime?.entities?.[entity.id] ?? []).map(flatten);
    rows[entity.id] = table;
    const qty = runtime?.cartQty?.[entity.id] ?? {};
    // ⚠ 原来是 `.map(... : null).filter((r): r is BindingRow => r != null)`：
    //   数组里混了 null（TS2322），而谓词 `r is BindingRow` 又不是元素类型
    //   `{qty} | null` 的子类型（TS2677）。flatMap 一步不产生 null，两条
    //   一起消掉，运行期行为不变（找不到对应行就不产出这一条）。
    cartRows[entity.id] = Object.entries(qty).flatMap(([id, n]) => {
      const row = table.find(r => String(r.id) === id);
      return row ? [{ ...row, qty: n }] : [];
    });
  }
  const selected = runtime?.selection;
  const extra =
    selected && Object.keys(selected).length ? { selected } : {};
  return { rows, fields, cartRows, ...extra };
}

/** 页面上引用了、而模型里没有的实体。给报告用——**不是**用来兜底造数据的。 */
export function missingEntities(
  source: BindingSource,
  referenced: readonly string[]
): string[] {
  return referenced.filter(id => !(id in source.fields));
}
