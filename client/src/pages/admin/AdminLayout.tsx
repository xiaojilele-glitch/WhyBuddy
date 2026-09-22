import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  FolderKanban,
  Shield,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/lib/use-auth";
import { cn } from "@/lib/utils";

interface AdminLayoutProps {
  children: ReactNode;
}

const adminNavItems = [
  { href: "/admin", label: "总览", icon: BarChart3 },
  { href: "/admin/users", label: "用户", icon: Users },
  { href: "/admin/projects", label: "项目", icon: FolderKanban },
  { href: "/admin/runs", label: "运行", icon: Activity },
  { href: "/admin/failures", label: "失败", icon: AlertTriangle },
  { href: "/admin/audit", label: "审计", icon: ClipboardList },
];

function AdminAccessCard({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <Card className="mx-auto mt-16 max-w-xl rounded-lg">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-slate-900 text-white">
            <Shield className="size-5" />
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {action ? <CardContent>{action}</CardContent> : null}
      </Card>
    </main>
  );
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user: currentUser, ready } = useAuth();

  // 还没问出登录态时不要下结论：直接判"未登录"会让已登录的管理员先看到一屏
  // "Sign in required"，再闪回控制台。
  if (!ready) {
    return (
      <AdminAccessCard
        title="正在确认登录"
        description="打开管理台前先确认账号。"
      />
    );
  }

  if (!currentUser) {
    return (
      <AdminAccessCard
        title="需要登录"
        description="请用超管账号登录后再打开管理台。"
        action={
          <Button asChild size="sm">
            <a href="/signin?next=/admin">去登录</a>
          </Button>
        }
      />
    );
  }

  if (!currentUser.isSuperuser) {
    return (
      <AdminAccessCard
        title="需要超管权限"
        description="当前账号可以用工作台，管理台只对超管开放。"
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-4 rounded-lg border bg-white p-3 shadow-sm">
            <div className="mb-4 flex items-center gap-2 px-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-slate-900 text-white">
                <Shield className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">管理台</p>
                <p className="truncate text-xs text-slate-500">
                  {currentUser?.email}
                </p>
              </div>
            </div>
            <nav aria-label="管理导航" className="space-y-1">
              {adminNavItems.map(item => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </a>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="mb-4 flex flex-col gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">管理台</h1>
                <Badge variant="secondary" className="rounded-md">
                  超管
                </Badge>
              </div>
              <p className="text-sm text-slate-500">
                用户、用量与停用。对照 Gitea 后台用户页，不是菜单权限。
              </p>
            </div>
            <nav
              aria-label="Admin sections"
              className="flex gap-1 overflow-x-auto lg:hidden"
            >
              {adminNavItems.map(item => (
                <Button
                  key={item.href}
                  asChild
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                >
                  <a href={item.href}>{item.label}</a>
                </Button>
              ))}
            </nav>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

export { AdminOverviewPage } from "./Overview";
export { AdminUsersPage } from "./Users";
export { AdminProjectsPage } from "./Projects";
export { AdminRunsPage } from "./Runs";
export { AdminFailuresPage } from "./Failures";
export { AdminAuditPage } from "./Audit";
