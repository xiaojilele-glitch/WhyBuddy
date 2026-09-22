/**
 * PartnersPanel — 「扩展中心」页里的伙伴层。
 *
 * 伙伴 = 一套预置好的能力组合 + 一句起手意图（见 partners.ts 头注：
 * 这里不做人设，人设是最容易造出一堆看着丰满、其实什么都不接的东西的地方）。
 *
 * ⚠ 每个伙伴的每一件依赖都**当场核对**：连接器在不在、技能装没装。
 *   缺什么就明说缺什么，按钮也不给按——一个看着能用、点了没反应的东西
 *   比没有这个东西更糟。
 *
 * ---
 *
 * 2026-08-26 第二次：四列卡片墙换成跟技能层同一套 Cursor 列表（见
 * marketplace-chrome.tsx）。「存成伙伴」还在顶栏——那颗是真能存的。
 *
 * ## 跟效果图**故意不一样**的三处
 *
 * 1. **只有 3 个，不是 40 个。** 效果图上是数据分析师、PPT 制作专家、
 *    UI 设计师…几十个职业名。我们只有 3 个真的能一键装配起来的组合，
 *    因为底下只有 2 个真连接器。摆 40 个点了没反应的，就是这条链路存在的
 *    理由要杀掉的东西（跟连接器页砍掉那 22 个假连接器同一条）。
 *
 * 2. **头像不画人。** 见 partner-art 的头注：头像由它装配的东西拼出来，
 *    换掉依赖头像跟着换，不会出现"图标说天气、实际接的是行情"。
 *
 * 3. **分类从依赖里汇出来，不是自己编一套。** 「出行生活」「金融」是连接器
 *    自己声明的 category（services/connectors.py），不是这一页硬写的词表。
 *    只有一种分类时不画这条——一个永远只能选它自己的筛选条，占着一行却
 *    什么也筛不动。
 *
 * ## 「我的伙伴」这次真的能攒了
 *
 * ⚠ 2026-08-26 发现的半截活：空态一直写着"在输入框里用 / 挂几个能力，再回
 *   这里存成小队"，而**存的入口根本不存在**——`partnerFromCurrent()` 早就
 *   写好也测过，就是没有任何地方调它。空态在教一条走不通的路，比空着更糟。
 *   这次把「存成伙伴」接上（顶栏那颗按钮），空态那句话才成立。
 */

import React from "react";
import { Input, Modal, Tag, Tooltip, message } from "antd";
import { Plus, Trash2, Users } from "lucide-react";

import {
  MarketAddButton,
  MarketChip,
  MarketEmpty,
  MarketPage,
  MarketRow,
  MarketSearch,
  MarketViewTab,
} from "./marketplace-chrome";

import {
  BUILTIN_PARTNERS,
  partnerFromCurrent,
  partnerReadiness,
  type Partner,
  type PartnerNeed,
} from "./partners";
import { PartnerAvatar } from "./partner-art/partner-avatar";
import { TruncatedText } from "./TruncatedText";
import type { ConnectorSpec } from "./connectors-client";
import type { SlashItem } from "./composer-slash";

const ALL = "全部";

const needKey = (n: { kind: string; key: string }) => `${n.kind}:${n.key}`;

function PartnerCard({
  partner,
  icons,
  ready,
  missing,
  attached,
  onUse,
  onDelete,
}: {
  partner: Partner;
  icons: string[];
  ready: boolean;
  missing: PartnerNeed[];
  attached: boolean;
  onUse: () => void;
  onDelete?: () => void;
}) {
  return (
    <MarketRow
      testid="partner-card"
      attr={{
        "data-partner": partner.id,
        "data-ready": ready ? "1" : "0",
        /* ⚠ 「已挂上」在 DOM 里是按钮文案，没挂时是「使用」。判据钉属性。 */
        "data-attached": attached ? "1" : "0",
      }}
      icon={<PartnerAvatar icons={icons} className="h-9 w-9" />}
      name={
        <TruncatedText
          text={partner.name}
          data-testid="partner-name"
          className="min-w-0"
        />
      }
      description={
        <>
          <TruncatedText
            text={partner.description || "（没有说明）"}
            data-testid="partner-desc"
            className="min-w-0"
          />
          {/*
            起手意图：点下去输入框里会出现的正是这段，先给人看见。
            ⚠ 内边距和夹断必须分两层（见 TruncatedText 头注）。列表行只给
              一行，不再用两行夹断+底色盒——那是卡片墙时代为了填高度。
          */}
          <div className="mt-0.5" data-testid="partner-opener-box">
            <TruncatedText
              text={partner.opener || "（没有起手意图）"}
              data-testid="partner-opener"
              className="min-w-0 text-[11px] text-slate-400"
            />
          </div>
        </>
      }
      meta={
        <div className="flex min-w-0 flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-1">
            {partner.needs.map(n => (
              <span
                key={needKey(n)}
                className={`rounded px-1.5 py-0.5 text-[10px] leading-4 ${
                  n.kind === "connector"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-sky-50 text-sky-700"
                }`}
              >
                {n.name}
              </span>
            ))}
          </div>
          {ready ? (
            <span className="text-[11px] text-slate-400">
              {partner.builtin ? "内置" : "我攒的"}
            </span>
          ) : (
            <TruncatedText
              data-testid="partner-missing"
              text={`还缺：${missing.map(m => m.name).join("、")}`}
              className="min-w-0 text-[#d46b08]"
            />
          )}
        </div>
      }
      action={
        <>
          {onDelete ? (
            <button
              type="button"
              data-testid="partner-delete"
              onClick={onDelete}
              title="删掉这个伙伴（只删本地存档）"
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <Tooltip
            title={
              ready
                ? "挂上它要的能力，把起手意图填进输入框，跳回推演"
                : `依赖还没齐：还缺 ${missing.map(m => m.name).join("、")}`
            }
          >
            <span>
              <MarketAddButton
                testid="partner-use"
                on={attached && ready}
                offLabel="使用"
                onLabel="已挂上"
                disabled={!ready}
                title={
                  ready
                    ? "挂上它要的能力，把起手意图填进输入框，跳回推演"
                    : `依赖还没齐：还缺 ${missing.map(m => m.name).join("、")}`
                }
                onClick={onUse}
              />
            </span>
          </Tooltip>
        </>
      }
    />
  );
}

/** 「存成伙伴」：把这一轮挂着的能力 + 一句起手意图存成自己的伙伴。 */
function SaveDialog({
  open,
  turnCaps,
  onClose,
  onSave,
}: {
  open: boolean;
  turnCaps: readonly SlashItem[];
  onClose: () => void;
  onSave: (p: Partner) => void;
}) {
  const [name, setName] = React.useState("");
  const [opener, setOpener] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName("");
      setOpener("");
    }
  }, [open]);

  const submit = () => {
    const p = partnerFromCurrent(name, turnCaps, opener);
    /* ⚠ partnerFromCurrent 一个能力都没挂就返回 null（存出来是个空壳）。
       这里按它的判断走，不自己再写一遍规则——两处规则迟早分叉。 */
    if (!p) {
      message.warning("给它起个名字，并且这一轮至少挂着一个连接器或技能");
      return;
    }
    onSave(p);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="存成我的伙伴"
      okText="存下来"
      cancelText="取消"
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <p className="mb-3 text-[12.5px] text-stone-500">
        存的是<b>这一轮挂着的能力</b>加你写的这句起手意图。下次点它，这套东西
        原样回来。
      </p>
      <div className="mb-3 flex flex-wrap gap-1">
        {turnCaps.length === 0 ? (
          <span className="text-[12px] text-[#d46b08]">
            这一轮一个能力都没挂——先在输入框里用 / 挂上连接器或技能
          </span>
        ) : (
          turnCaps.map(c => (
            <Tag
              key={needKey(c)}
              color={c.kind === "connector" ? "green" : "blue"}
              style={{ marginInlineEnd: 0 }}
            >
              {c.name}
            </Tag>
          ))
        )}
      </div>
      <Input
        autoFocus
        value={name}
        maxLength={24}
        onChange={e => setName(e.target.value)}
        placeholder="给它起个名字，比如「晨会看板」"
        data-testid="partner-save-name"
      />
      <Input.TextArea
        className="mt-2"
        value={opener}
        onChange={e => setOpener(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        placeholder="起手意图：下次点它，这段话会填进输入框（可以留空）"
        data-testid="partner-save-opener"
      />
    </Modal>
  );
}

export function PartnersPanel({
  custom,
  connectors,
  skillKeys,
  attachedKeys,
  turnCaps,
  onUse,
  onSave,
  onDelete,
  initialMine = false,
}: {
  custom: Partner[];
  /** 后端报上来的连接器清单（要它的 category 和 icon，不只是 id） */
  connectors: ConnectorSpec[];
  skillKeys: string[];
  /** 这一轮已经挂着的能力，形如 `connector:weather` */
  attachedKeys: string[];
  turnCaps: SlashItem[];
  onUse: (p: Partner) => void;
  onSave: (p: Partner) => void;
  onDelete: (id: string) => void;
  /** 初始是否只看「我的」（测试用；产品默认看全部） */
  initialMine?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(ALL);
  const [mineOnly, setMineOnly] = React.useState(initialMine);
  const [saving, setSaving] = React.useState(false);

  const specById = React.useMemo(
    () => new Map(connectors.map(c => [c.id, c])),
    [connectors]
  );
  const connectorIds = React.useMemo(
    () => connectors.filter(c => c.available).map(c => c.id),
    [connectors]
  );

  /** 这个伙伴归哪些分类：从它接的连接器自己声明的 category 汇出来。 */
  const catsOf = React.useCallback(
    (p: Partner) => {
      const out: string[] = [];
      for (const n of p.needs) {
        if (n.kind !== "connector") continue;
        const c = specById.get(n.key)?.category;
        if (c && !out.includes(c)) out.push(c);
      }
      return out;
    },
    [specById]
  );

  /** 头像用的图稿名，顺序跟 needs 一致（拿不到 spec 的跳过，不占位）。 */
  const iconsOf = React.useCallback(
    (p: Partner) =>
      p.needs
        .map(n => (n.kind === "connector" ? specById.get(n.key)?.icon : undefined))
        .filter((x): x is string => !!x),
    [specById]
  );

  const all = React.useMemo(
    () => [...custom, ...BUILTIN_PARTNERS],
    [custom]
  );

  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const p of all) {
      for (const c of catsOf(p)) if (!seen.includes(c)) seen.push(c);
    }
    /* ⚠ 只有一种分类时不画这条筛选条（跟连接器层同一条判断）。
       「全部」已经是左边那颗 view tab，分类条不再铺一颗同名的。 */
    return seen.length > 1 ? seen : [];
  }, [all, catsOf]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(p => {
      if (mineOnly && p.builtin) return false;
      if (category !== ALL && !catsOf(p).includes(category)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.opener.toLowerCase().includes(q) ||
        p.needs.some(n => n.name.toLowerCase().includes(q))
      );
    });
  }, [all, mineOnly, category, query, catsOf]);

  const mine = shown.filter(p => !p.builtin);
  const builtin = shown.filter(p => p.builtin);

  const card = (p: Partner) => {
    const { ready, missing } = partnerReadiness(p, { connectorIds, skillKeys });
    return (
      <PartnerCard
        key={p.id}
        partner={p}
        icons={iconsOf(p)}
        ready={ready}
        missing={missing}
        attached={
          p.needs.length > 0 &&
          p.needs.every(n => attachedKeys.includes(needKey(n)))
        }
        onUse={() => onUse(p)}
        {...(p.builtin ? {} : { onDelete: () => onDelete(p.id) })}
      />
    );
  };

  return (
    <MarketPage
      testid="partners-list"
      title="伙伴"
      icon={<Users size={18} strokeWidth={2.2} />}
      extra={
        <>
          <span className="text-[13px] text-slate-400" data-testid="partner-count">
            {all.length} 个
          </span>
          <Tooltip
            title={
              turnCaps.length > 0
                ? "把这一轮挂着的能力存成你自己的伙伴"
                : "这一轮还没挂能力：先在输入框里用 / 挂上连接器或技能，再回来存"
            }
          >
            <span>
              <button
                type="button"
                disabled={turnCaps.length === 0}
                data-testid="partner-save-open"
                onClick={() => setSaving(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                存成伙伴
              </button>
            </span>
          </Tooltip>
        </>
      }
      search={
        <MarketSearch
          value={query}
          onChange={setQuery}
          placeholder="搜索伙伴"
          testid="partner-search"
        />
      }
      tabs={
        <>
          <MarketViewTab
            testid="partner-view-all"
            label="全部"
            count={all.length}
            active={!mineOnly && category === ALL}
            onClick={() => {
              setMineOnly(false);
              setCategory(ALL);
            }}
          />
          <MarketViewTab
            testid="partner-mine"
            label="我的"
            count={custom.length}
            active={mineOnly}
            onClick={() => setMineOnly(true)}
          />
        </>
      }
      chips={
        categories.length > 0 ? (
          <div className="contents" data-testid="partner-cats">
            {categories.map(cat => (
              <MarketChip
                key={cat}
                testid="partner-cat"
                label={cat}
                count={all.filter(p => catsOf(p).includes(cat)).length}
                active={!mineOnly && category === cat}
                onClick={() => {
                  setMineOnly(false);
                  setCategory(cat);
                }}
                attr={{
                  "data-cat": cat,
                  "data-active": !mineOnly && category === cat ? "1" : "0",
                }}
              />
            ))}
          </div>
        ) : null
      }
    >
      {mine.length > 0 ? (
        <section data-testid="partners-mine" className="divide-y divide-slate-200/60">
          {mine.map(card)}
        </section>
      ) : null}

      {mineOnly && mine.length === 0 ? (
        <MarketEmpty>
          {custom.length === 0
            ? "还没攒过伙伴——在输入框里用 / 挂几个能力，再回这里点「存成伙伴」"
            : `我攒的伙伴里没有匹配「${query || category}」的`}
        </MarketEmpty>
      ) : null}

      {!mineOnly ? (
        <section data-testid="partners-builtin" className="divide-y divide-slate-200/60">
          {builtin.length === 0 ? (
            <MarketEmpty>{`没有匹配「${query || category}」的伙伴`}</MarketEmpty>
          ) : (
            builtin.map(card)
          )}
        </section>
      ) : null}

      <SaveDialog
        open={saving}
        turnCaps={turnCaps}
        onClose={() => setSaving(false)}
        onSave={onSave}
      />
    </MarketPage>
  );
}
