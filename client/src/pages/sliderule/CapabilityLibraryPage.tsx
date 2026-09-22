/**
 * CapabilityLibraryPage — 「扩展中心」一页三层。
 *
 * 2026-08-25 用户裁决（参照豆包工作台）：这三样是同一件事的三种粒度，
 * 不该散在三个入口里——
 *   技能   一段流程（进提示词，影响怎么生成）
 *   连接器 一个真实数据源（进运行时，影响页面上显示什么）
 *   伙伴   前两者的装配 + 一句起手意图
 *
 * ⚠ 技能那一层直接复用 SkillsLibraryPage，**不复制一份**。复制出来的第二份
 *   会跟原件慢慢分叉（仓里第四条：同一件事两处实现，改一处不报错、只有一半
 *   不生效）。这里只加壳。
 *
 * ⚠ 2026-08-26：页内不再画「技能 / 连接器 / 伙伴」二次菜单。侧栏扩展中心
 *   已经有这三条子项（DashboardApp 的 capabilityLayer），再画一遍就是
 *   应用市场/组件库没有、只有这一页有的第二套导航——看着像进了另一个产品。
 *   切层只走侧栏；`data-layer` 留在根上给烟测认现在停在哪一层。
 */

import React from "react";
import { message } from "antd";
import { navigate } from "wouter/use-browser-location";

import SkillsLibraryPage from "./SkillsLibraryPage";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { PartnersPanel } from "./PartnersPanel";
import { listConnectors, type ConnectorSpec } from "./connectors-client";
import { installKeyOf, loadInstalledSkills } from "./installed-skills";
import {
  loadPartners,
  partnerCapabilities,
  savePartners,
  type Partner,
} from "./partners";
import {
  loadTurnCapabilities,
  pickedConnectorIds,
  saveTurnCapabilities,
  setPendingOpener,
} from "./turn-capabilities";
import type { SlashItem } from "./composer-slash";

type Layer = "skills" | "connectors" | "partners";

export function CapabilityLibraryPage({
  initialLayer = "skills",
}: {
  initialLayer?: Layer;
} = {}) {
  /* 层由侧栏 capabilityLayer 决定。父级带了 key={capabilityLayer}，
     切层会整页重挂，所以这里读 props 就够，不必再备一份会跟侧栏分叉的 state。 */
  const layer = initialLayer;
  const [connectors, setConnectors] = React.useState<ConnectorSpec[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [custom, setCustom] = React.useState<Partner[]>(() => loadPartners());

  React.useEffect(() => {
    let alive = true;
    void listConnectors().then(list => {
      if (!alive) return;
      setConnectors(list);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const skillKeys = React.useMemo(
    () => loadInstalledSkills().map(installKeyOf),
    // 切到伙伴层时重读——用户可能刚在技能层装了一个
    [layer]
  );
  const connectorIds = React.useMemo(
    () => connectors.filter(c => c.available).map(c => c.id),
    [connectors]
  );

  /*
   * 这一轮挂着的能力。
   *
   * ⚠ 页面自己也要留一份 state：连接器卡上的「+ / ✓ 已添加」得**当场**变，
   *   而 turn-capabilities 是 localStorage，写完不会通知任何人重渲染。
   *   只写存档不更 state 的话，用户点了 +，图标纹丝不动——又一个"点了没反应"。
   */
  const [turnCaps, setTurnCaps] = React.useState<SlashItem[]>(() =>
    loadTurnCapabilities()
  );
  const attachedConnectorIds = React.useMemo(
    () => pickedConnectorIds(turnCaps),
    [turnCaps]
  );

  const detach = React.useCallback((kind: SlashItem["kind"], key: string) => {
    setTurnCaps(prev => {
      const next = prev.filter(p => !(p.kind === kind && p.key === key));
      saveTurnCapabilities(next);
      return next;
    });
  }, []);

  /** 挂到这一轮：跟输入框里 `/` 选中同一条路径（同一个存档键）。 */
  const attach = React.useCallback(
    (items: SlashItem[], opts?: { opener?: string; goto?: boolean }) => {
      if (items.length === 0) return;
      setTurnCaps(prev => {
        const merged = [...prev];
        for (const item of items) {
          if (!merged.some(p => p.kind === item.kind && p.key === item.key))
            merged.push(item);
        }
        saveTurnCapabilities(merged);
        return merged;
      });
      if (opts?.opener) setPendingOpener(opts.opener);
      message.success(
        `已挂到这一轮：${items.map(i => i.name).join("、")}${opts?.opener ? "，起手意图已填进输入框" : ""}`
      );
      /* ⚠ 连接器卡上点「+」**不跳页**：用户是在挑连接器，跳走了他就看不到
         「已添加」变过来，也没法接着挑第二个。伙伴那颗「用这个伙伴」才跳
         ——那是"照这个模板开一局"的显式动作。 */
      if (opts?.goto !== false) navigate("/agent-loop/sliderule");
    },
    []
  );

  return (
    <div
      className="h-full min-h-0"
      data-testid="capability-library"
      data-layer={layer}
    >
      {/* ⚠ 技能层用复用而不是复制，见文件头注 */}
      {layer === "skills" ? <SkillsLibraryPage /> : null}
      {layer === "connectors" ? (
        <ConnectorsPanel
          connectors={connectors}
          loading={loading}
          attachedIds={attachedConnectorIds}
          onUse={spec =>
            attach(
              [
                {
                  key: spec.id,
                  kind: "connector",
                  name: spec.name,
                  description: spec.description,
                },
              ],
              { goto: false }
            )
          }
          onDetach={spec => detach("connector", spec.id)}
        />
      ) : null}
      {layer === "partners" ? (
        <PartnersPanel
          custom={custom}
          /* ⚠ 传整份 spec 而不是 id 列表：伙伴层要拿连接器自己声明的
             category（分类条）和 icon（头像）。只传 id 的话这两样只能
             在前端另编一套词表，编出来的迟早跟后端对不上。 */
          connectors={connectors}
          skillKeys={skillKeys}
          attachedKeys={turnCaps.map(c => `${c.kind}:${c.key}`)}
          turnCaps={turnCaps}
          onUse={p =>
            attach(partnerCapabilities(p, { connectorIds, skillKeys }), {
              opener: p.opener,
            })
          }
          onSave={p =>
            setCustom(prev => {
              const next = [p, ...prev.filter(x => x.id !== p.id)];
              savePartners(next);
              message.success(`已存成伙伴「${p.name}」`);
              return next;
            })
          }
          onDelete={id =>
            setCustom(prev => {
              const next = prev.filter(x => x.id !== id);
              savePartners(next);
              return next;
            })
          }
        />
      ) : null}
    </div>
  );
}

export default CapabilityLibraryPage;
