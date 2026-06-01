import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Hash, Loader2, LogIn, Mail, ShieldCheck, UserPlus, UserRound } from "lucide-react";
import { useLocation } from "wouter";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { BRAND_NAME_FULL } from "@shared/brand";

type AuthMode = "login" | "code" | "register";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const currentUser = useAuthStore(state => state.currentUser);
  const loading = useAuthStore(state => state.loading);
  const error = useAuthStore(state => state.error);
  const login = useAuthStore(state => state.login);
  const sendEmailLoginCode = useAuthStore(state => state.sendEmailLoginCode);
  const loginWithEmailCode = useAuthStore(state => state.loginWithEmailCode);
  const register = useAuthStore(state => state.register);
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (currentUser) {
      setLocation("/");
    }
  }, [currentUser, setLocation]);

  const copy = useMemo(() => {
    if (mode === "register") {
      return {
        title: "Create account",
        subtitle: "Start a personal WhyBuddy workspace.",
        action: "Create account",
        swap: "Sign in instead",
      };
    }

    if (mode === "code") {
      return {
        title: "Email code",
        subtitle: "Sign in with a one-time code sent to your inbox.",
        action: "Sign in with code",
        swap: "Use password instead",
      };
    }

    return {
      title: "Sign in",
      subtitle: "Continue to your project workspace.",
      action: "Sign in",
      swap: "Create account",
    };
  }, [mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok =
      mode === "code"
        ? await loginWithEmailCode({ email, code })
        : mode === "login"
          ? await login({ email, password })
          : await register({
              email,
              password,
              displayName: displayName.trim() || undefined,
            });

    if (ok) {
      setLocation("/");
    }
  }

  async function handleSendCode() {
    const ok = await sendEmailLoginCode({ email });
    if (ok) {
      setCodeSent(true);
      setCode("");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-950">
      <section className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-sky-100 bg-sky-50 text-sky-700">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-500">
              {BRAND_NAME_FULL}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              {copy.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2 rounded-md bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 transition-colors",
              mode === "login" && "bg-white text-slate-950 shadow-xs"
            )}
          >
            <LogIn className="size-4" />
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("code")}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 transition-colors",
              mode === "code" && "bg-white text-slate-950 shadow-xs"
            )}
          >
            <Hash className="size-4" />
            Code
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 transition-colors",
              mode === "register" && "bg-white text-slate-950 shadow-xs"
            )}
          >
            <UserPlus className="size-4" />
            Register
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  autoComplete="name"
                  className="pl-9"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                autoComplete="email"
                required
                className="pl-9"
              />
            </div>
          </div>

          {mode === "code" ? (
            <div className="space-y-2">
              <Label htmlFor="email-code">Code</Label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Hash className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoComplete="one-time-code"
                    required
                    className="pl-9 tracking-[0.28em]"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={handleSendCode}
                  disabled={loading || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                  {codeSent ? "Resend" : "Send"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                required
              />
            </div>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {copy.action}
          </Button>
        </form>

        <div className="mt-5 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode(mode === "register" ? "login" : mode === "code" ? "login" : "register")}
          >
            {copy.swap}
          </Button>
        </div>
      </section>
    </main>
  );
}
