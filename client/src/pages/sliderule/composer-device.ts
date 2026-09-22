/**
 * 作曲家目标形态。合法域跟账本设备对齐，不再手写两档。
 *
 * ⚠ 2026-08-30 用户圈了空态「应用 / Web」两颗并排芯片：平板 / 手表 /
 * 以后小游戏再加一档，tab 就放不下。改成一颗下拉，默认 Web；未接通的
 * （手表）只出现在菜单里、不许选——选了也不许写成 preferredDevice。
 * 小游戏是原型轴，不进这颗钮（范围卡上选），两轴混一颗发送会分不清。
 */
import {
  allDeviceForms,
  defaultDevice,
  isWiredDevice,
  parsePreferredDevice,
} from "./product-archetypes";

export type ComposerDevice = string;

export type ComposerDeviceOption = {
  id: ComposerDevice;
  label: string;
  wired: boolean;
  title: string;
};

export function parseComposerDevice(raw: unknown): ComposerDevice {
  return parsePreferredDevice(raw);
}

const COMPOSER_LABELS: Record<string, string> = {
  desktop: "Web",
  phone: "应用",
  tablet: "平板",
  watch: "手表",
};

const COMPOSER_TITLES: Record<string, string> = {
  desktop: "按网页应用推演（横屏、侧栏）",
  phone: "按手机应用推演（竖屏、底栏）",
  tablet: "按平板应用推演（手持或支起、近桌面视野）",
  watch: "手表还没接通生成侧，选了也不会点火",
};

/** Web 默认、最常见，放第一档。账本 $order 是判定提示词顺序，不搬到空态菜单。 */
const COMPOSER_MENU_ORDER = ["desktop", "phone", "tablet", "watch"];

function composerLabel(id: string, fallback: string): string {
  return COMPOSER_LABELS[id] || fallback;
}

function composerTitle(id: string, wired: boolean): string {
  if (COMPOSER_TITLES[id]) return COMPOSER_TITLES[id];
  return wired ? `按${composerLabel(id, id)}推演` : `${composerLabel(id, id)}还没接通生成侧`;
}

export function composerDeviceMenu(): ComposerDeviceOption[] {
  const forms = allDeviceForms();
  const rank = (id: string) => {
    const at = COMPOSER_MENU_ORDER.indexOf(id);
    return at === -1 ? COMPOSER_MENU_ORDER.length : at;
  };
  return forms
    .slice()
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map(row => ({
      id: row.id,
      label: composerLabel(row.id, row.label),
      wired: row.wired,
      title: composerTitle(row.id, row.wired),
    }));
}

/** 接通档，发送路径只认这些。 */
export const COMPOSER_DEVICE_OPTIONS: ComposerDeviceOption[] =
  composerDeviceMenu().filter(row => row.wired);

export function composerDeviceTriggerLabel(device: ComposerDevice): string {
  const row = composerDeviceMenu().find(item => item.id === device);
  return row?.label || composerLabel(device, "Web");
}

/**
 * 空态输入框的占位字。只说要写什么，不夹「输入 / 挂技能」。
 *
 * ⚠ 2026-08-26 上午在占位符尾巴加了「（输入 / 挂技能或连接器）」，下午用户
 *   指着首页圈了四处：占位符、框内 hint、工具条钮，同一句话写了三遍。
 *   斜杠入口只留工具条那颗 `/`（sliderule-slash-hint），
 *   占位符回到只描述任务。再加回去，空框里又是三处重复。
 */
export function composerHeroPlaceholder(device: ComposerDevice): string {
  const what =
    device === "phone"
      ? "手机应用"
      : device === "tablet"
        ? "平板应用"
        : "业务系统";
  return `描述你想构建的${what}…`;
}

export { defaultDevice, isWiredDevice };
