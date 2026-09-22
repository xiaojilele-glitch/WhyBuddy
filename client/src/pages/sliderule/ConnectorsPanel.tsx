/**
 * ConnectorsPanel — 「扩展中心」页里的连接器层。
 *
 * 2026-08-26 第二次：四列卡片墙换成跟技能层同一套 Cursor 列表（见
 * marketplace-chrome.tsx）。「+ / ✓ 已添加」的语义没变。
 *
 * ## 跟效果图**故意不一样**的两处
 *
 * 1. **卡片只列真的能用的。** 效果图里是 24 个（钉钉、飞书、Notion、
 *    腾讯会议、高德地图…），我们只有 2 个。把另外 22 个摆上去，点了不通，
 *    就是这整条链路存在的理由要杀掉的东西——比"没有这个连接器"更糟，因为
 *    用户会以为接得上。数字（"N 个"）也照实数，不写死 24。
 *
 * 2. **没有「+ 新建」。** 自定义连接器还没做（连接器由服务端注册表提供，
 *    见 services/connectors.py）。放一颗打不开任何东西的按钮，跟第 1 条
 *    同一个毛病。做出来那天再加。
 *
 * 「我的连接器」保留了，因为它有真实语义：只看**这一轮挂着**的那些。
 *
 * ## 「+ / 已添加」是什么
 *
 * 是"挂不挂在这一轮推演上"（turn-capabilities），跟输入框里 `/` 选中同一条
 * 路径、同一个存档键。**不是**"安装"——连接器没有安装这一步，装出一个假的
 * 安装态只会让人以为还得先装。
 *
 * ⚠ 试取真数据藏在卡片展开里，但**没有降级**：它仍然是这一页最有说服力的
 *   东西（不是"我们支持天气"，是"这就是北京明天的降水概率 78%"）。失败时
 *   如实说原因并且**一行都不显示**——给一张编出来的示例表当"成功"，比直接
 *   报错危险得多。
 */

import React from "react";
import { Alert, Button, Input, Table } from "antd";
import { Cable, RefreshCw } from "lucide-react";

import { ConnectorIcon } from "./connector-art/connector-icons";
import { TruncatedText } from "./TruncatedText";
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
  fetchConnectorRows,
  type ConnectorFetchResult,
  type ConnectorSpec,
} from "./connectors-client";

const FEATURED = "精选";

function ConnectorCard({
  spec,
  attached,
  onToggle,
}: {
  spec: ConnectorSpec;
  attached: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [args, setArgs] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(spec.args.map(a => [a.id, a.default]))
  );
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ConnectorFetchResult | null>(null);

  const preview = async () => {
    setBusy(true);
    try {
      setResult(await fetchConnectorRows(spec.id, args));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketRow
      testid="connector-card"
      attr={{
        "data-connector": spec.id,
        "data-attached": attached ? "1" : "0",
      }}
      open={open}
      icon={<ConnectorIcon icon={spec.icon} className="h-9 w-9" />}
      name={
        <button
          type="button"
          data-testid="connector-expand"
          onClick={() => setOpen(v => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left"
          title="展开：填参数、试取真数据"
        >
          <TruncatedText
            text={spec.name}
            data-testid="connector-name"
            className="min-w-0"
          />
          {spec.available ? null : (
            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] leading-4 text-amber-700">
              未配置凭据
            </span>
          )}
        </button>
      }
      description={
        <TruncatedText
          text={spec.description}
          data-testid="connector-desc"
          className="min-w-0"
        />
      }
      meta={
        <TruncatedText
          text={`落成实体「${spec.entityName}」· ${spec.fields.length} 个字段 · 来源 ${spec.source}`}
          data-testid="connector-meta"
          className="min-w-0"
        />
      }
      action={
        <MarketAddButton
          testid="connector-attach"
          on={attached}
          offLabel="添加"
          onLabel="已添加"
          title={attached ? "已挂在这一轮，点一下摘掉" : "挂到这一轮推演上"}
          onClick={onToggle}
        />
      }
    >
      {open ? (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2">
          <div className="flex flex-wrap items-end gap-2">
            {spec.args.map(a => (
              <label key={a.id} className="text-[11px] text-stone-500">
                <span className="mb-0.5 block">{a.name}</span>
                <Input
                  size="small"
                  style={{ width: 220 }}
                  value={args[a.id] ?? ""}
                  placeholder={a.placeholder}
                  data-testid="connector-arg"
                  onChange={e =>
                    setArgs(prev => ({ ...prev, [a.id]: e.target.value }))
                  }
                />
              </label>
            ))}
            <Button
              size="small"
              icon={<RefreshCw className="h-3 w-3" />}
              loading={busy}
              disabled={!spec.available}
              data-testid="connector-preview"
              onClick={preview}
            >
              试取真数据
            </Button>
          </div>

          {result && !result.ok ? (
            /* ⚠ 失败时**一行都不显示**。给一张示例表当"成功"比直接报错危险得多。 */
            <Alert
              className="mt-2.5"
              type="warning"
              showIcon
              data-testid="connector-error"
              message={result.error}
            />
          ) : null}

          {result?.ok ? (
            <div className="mt-2.5" data-testid="connector-preview-result">
              <div className="mb-1 text-[11px] text-stone-400">
                {result.rows.length} 行 · {result.source} ·{" "}
                {result.fetchedAt.replace("T", " ").slice(0, 16)} 取
              </div>
              {result.rows.length === 0 ? (
                <div className="py-3 text-[12px] text-slate-400">这次没有取到行</div>
              ) : (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: true, y: 220 }}
                  dataSource={result.rows}
                  columns={spec.fields.map(f => ({
                    title: f.name,
                    dataIndex: ["values", f.id],
                    key: f.id,
                    render: (v: unknown) =>
                      v === null || v === undefined || v === "" ? (
                        /* ⚠ 不适用的字段显示「—」，不是 0。指数没有市净率，
                           写 0.00 每个像素都像真的，只有那一格是编的。 */
                        <span className="text-stone-300">—</span>
                      ) : (
                        String(v)
                      ),
                  }))}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </MarketRow>
  );
}

export function ConnectorsPanel({
  connectors,
  loading,
  attachedIds,
  onUse,
  onDetach,
  initialMine = false,
}: {
  connectors: ConnectorSpec[];
  loading: boolean;
  /** 这一轮已经挂着的连接器 id */
  attachedIds: string[];
  onUse: (spec: ConnectorSpec) => void;
  onDetach: (spec: ConnectorSpec) => void;
  /** 初始是否只看「已添加」（测试用；产品默认看全部） */
  initialMine?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(FEATURED);
  const [mineOnly, setMineOnly] = React.useState(initialMine);

  /* 分类条：从连接器自己声明的 category 汇出来。
     ⚠ 只有一种分类时不画这条——一个永远只能选它自己的筛选条，占着一行
       却什么也筛不动。 */
  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const c of connectors) {
      if (c.category && !seen.includes(c.category)) seen.push(c.category);
    }
    /* 「全部」已经是左边那颗 view tab，不再铺一颗「精选」当同类入口。 */
    return seen.length > 1 ? seen : [];
  }, [connectors]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter(c => {
      if (mineOnly && !attachedIds.includes(c.id)) return false;
      if (category !== FEATURED && c.category !== category) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.entityName.toLowerCase().includes(q) ||
        c.source.toLowerCase().includes(q)
      );
    });
  }, [connectors, query, category, mineOnly, attachedIds]);

  if (loading) {
    return (
      <MarketPage
        testid="connectors-list"
        title="连接器"
        icon={<Cable size={18} strokeWidth={2.2} />}
        search={
          <MarketSearch
            value=""
            onChange={() => undefined}
            placeholder="搜索连接器"
            testid="connector-search"
          />
        }
      >
        <MarketEmpty>连接器清单加载中…</MarketEmpty>
      </MarketPage>
    );
  }
  if (connectors.length === 0) {
    return (
      <MarketPage
        testid="connectors-list"
        title="连接器"
        icon={<Cable size={18} strokeWidth={2.2} />}
        search={
          <MarketSearch
            value=""
            onChange={() => undefined}
            placeholder="搜索连接器"
            testid="connector-search"
          />
        }
      >
        <MarketEmpty>
          没有取到连接器清单——Python 服务没起来，或者这台机器上还没配连接器
        </MarketEmpty>
      </MarketPage>
    );
  }

  return (
    <MarketPage
      testid="connectors-list"
      title="连接器"
      icon={<Cable size={18} strokeWidth={2.2} />}
      extra={
        <span className="text-[13px] text-slate-400" data-testid="connector-count">
          {connectors.length} 个
        </span>
      }
      search={
        <MarketSearch
          value={query}
          onChange={setQuery}
          placeholder="搜索连接器"
          testid="connector-search"
        />
      }
      tabs={
        <>
          <MarketViewTab
            testid="connector-view-all"
            label="全部"
            count={connectors.length}
            active={!mineOnly && category === FEATURED}
            onClick={() => {
              setMineOnly(false);
              setCategory(FEATURED);
            }}
          />
          <MarketViewTab
            testid="connector-mine"
            label="已添加"
            count={attachedIds.length}
            active={mineOnly}
            onClick={() => setMineOnly(true)}
          />
        </>
      }
      chips={
        categories.length > 0 ? (
          <div className="contents" data-testid="connector-cats">
            {categories.map(cat => (
              <MarketChip
                key={cat}
                testid="connector-cat"
                label={cat}
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
      {shown.length === 0 ? (
        <MarketEmpty>
          {mineOnly
            ? "这一轮还没挂任何连接器"
            : `没有匹配「${query || category}」的连接器`}
        </MarketEmpty>
      ) : (
        <div
          data-testid="connectors-featured-list"
          className="divide-y divide-slate-200/60"
        >
          {shown.map(c => {
            const attached = attachedIds.includes(c.id);
            return (
              <ConnectorCard
                key={c.id}
                spec={c}
                attached={attached}
                onToggle={() => (attached ? onDetach(c) : onUse(c))}
              />
            );
          })}
        </div>
      )}
    </MarketPage>
  );
}
