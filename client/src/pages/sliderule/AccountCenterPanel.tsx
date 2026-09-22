/**
 * 设置中心「用户中心」：昵称 + 头像。
 *
 * ⚠ 2026-08-20：对照从 TRAE 个人信息卡改成 Cursor Account——头像在左、
 * 名字和邮箱叠在旁边，下面才是可改字段行。没有订阅/手机号那些——我们没有。
 */
import { UserRound } from "lucide-react";
import React from "react";
import { toast } from "sonner";

import { updateProfile } from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";
import { SETTINGS_INPUT_CLASS, SettingsRow, SettingsSection } from "./settings-ui";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const NAME_MAX = 40;

function initialsOf(user: { displayName?: string | null; email: string }): string {
  const source = (user.displayName || user.email || "").trim();
  if (!source) return "";
  const cjk = source.match(/[一-龥]/g);
  if (cjk && cjk.length >= 2) return cjk.slice(-2).join("");
  return source.slice(0, 1).toUpperCase();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export function AccountCenterPanel() {
  const { user, ready, refresh } = useAuth();
  const [name, setName] = React.useState("");
  const [savingName, setSavingName] = React.useState(false);
  const [savingAvatar, setSavingAvatar] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setName(user?.displayName || "");
  }, [user?.displayName, user?.id]);

  if (!ready) {
    return (
      <p className="text-[13px] text-[#737373]" data-testid="sliderule-account-center">
        正在确认登录状态…
      </p>
    );
  }

  if (!user) {
    return (
      <div data-testid="sliderule-account-center">
        <SettingsSection>
          <div className="px-4 py-5 text-[13px] leading-5 text-[#52525b]">
            登录后可设置昵称和头像。
            <a
              className="ml-1 font-medium text-[#171717] underline underline-offset-2 hover:no-underline"
              href={`/signin?next=${encodeURIComponent("/agent-loop/settings")}`}
            >
              去登录
            </a>
          </div>
        </SettingsSection>
      </div>
    );
  }

  const saveName = async () => {
    const next = name.trim();
    if (next === (user.displayName || "").trim()) return;
    if (next.length > NAME_MAX) {
      toast.error(`昵称最多 ${NAME_MAX} 个字`);
      return;
    }
    setSavingName(true);
    try {
      await updateProfile({ displayName: next });
      await refresh();
      toast.success("昵称已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingName(false);
    }
  };

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("头像不能超过 2 MB");
      return;
    }
    if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.type)) {
      toast.error("请上传 JPG、PNG、GIF 或 WebP 图片");
      return;
    }
    setSavingAvatar(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await updateProfile({ avatarUrl: dataUrl });
      await refresh();
      toast.success("头像已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "头像保存失败");
    } finally {
      setSavingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const shownName = (user.displayName || "").trim() || user.email;

  return (
    <div className="space-y-8" data-testid="sliderule-account-center">
      <SettingsSection>
        <div
          className="flex items-center gap-4 px-4 py-5"
          data-testid="sliderule-account-profile"
        >
          <button
            type="button"
            disabled={savingAvatar}
            onClick={() => fileRef.current?.click()}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[#e4e4e7] text-[15px] font-semibold text-[#52525b] ring-1 ring-black/[0.08] transition hover:ring-black/20 disabled:opacity-60"
            title="更换头像"
            data-testid="sliderule-account-avatar"
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initialsOf(user) || <UserRound className="mx-auto h-6 w-6" />
            )}
          </button>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-[#171717]">
              {shownName}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-[#737373]">{user.email}</div>
            <button
              type="button"
              disabled={savingAvatar}
              onClick={() => fileRef.current?.click()}
              className="mt-1.5 text-[12px] font-medium text-[#52525b] underline-offset-2 hover:underline disabled:opacity-50"
            >
              更换头像
            </button>
            <p className="mt-0.5 text-[11px] text-[#a3a3a3]">
              JPG、PNG、GIF 或 WebP，最大 2 MB
            </p>
          </div>
          {user.isSuperuser ? (
            <span className="ml-auto shrink-0 rounded-md bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-[#171717]">
              Admin
            </span>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            data-testid="sliderule-account-avatar-file"
            onChange={event => void onPickAvatar(event.target.files?.[0])}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="档案">
        <SettingsRow title="昵称" description="对外显示的名称">
          <input
            value={name}
            maxLength={NAME_MAX}
            disabled={savingName}
            onChange={event => setName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveName();
              }
            }}
            placeholder={user.email}
            className={`${SETTINGS_INPUT_CLASS} w-[220px] text-right`}
            data-testid="sliderule-account-name"
          />
        </SettingsRow>
        <SettingsRow title="邮箱" description="用于登录，不可在此修改">
          <span className="max-w-[240px] truncate text-[13px] text-[#737373]">
            {user.email}
          </span>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
