import { useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { FlaskConical, KeyRound, MailCheck, Building2, ServerCog, ArrowRight, PlugZap, ShieldCheck, Lock } from "lucide-react";
import { ModeBar } from "./ModeBar";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FullPageLoader } from "@/components/ui/Feedback";
import type { Permission } from "@shared/types";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/utils";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("paypilot:sidebar") === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return (
    <div className="min-h-dvh">
      <ModeBar />
      <div className="flex">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => (localStorage.setItem("paypilot:sidebar", c ? "0" : "1"), !c))}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <div className="flex-1 min-w-0">
          <Topbar onMenu={() => setMobileOpen(true)} />
          <main className="px-4 sm:px-6 py-6 max-w-[1500px] mx-auto">
            <RealModeGate>
              <Outlet />
            </RealModeGate>
          </main>
        </div>
      </div>
    </div>
  );
}

/** In Real Mode, blocks data pages until the workspace can actually load real data. */
function RealModeGate({ children }: { children: ReactNode }) {
  const { mode, realBlocker, requestMode, org, repo, orgsLoading } = useWorkspace();
  const { reloadUser, resendVerification, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  if (mode === "demo") return org ? <>{children}</> : <FullPageLoader label="Preparing demo workspace…" />;
  // Settings/Integrations stay reachable for configuration help.
  const open = ["/integrations", "/settings"].some((p) => loc.pathname.startsWith(p));
  if (!realBlocker) {
    if (repo && !org) return <FullPageLoader label="Loading your organization…" />;
    return <>{children}</>;
  }
  if (open && realBlocker !== "guest" && realBlocker !== "firebase_not_configured") return <>{children}</>;
  if (orgsLoading && realBlocker === "no_org") return <FullPageLoader label="Loading your organizations…" />;

  const content = {
    firebase_not_configured: {
      icon: ServerCog,
      title: "Real Mode needs a Firebase project",
      body: (
        <>
          <p>This copy of PayPilot is running without backend configuration, so it can't sign you in or store real business data. Nothing is faked — Real Mode simply stays empty until it's connected.</p>
          <ol className="mt-3 space-y-1.5 list-decimal pl-5">
            <li>Create a Firebase project and enable Authentication (Email/Password + Google) and Firestore.</li>
            <li>Copy <code className="font-mono text-xs">.env.example</code> to <code className="font-mono text-xs">.env</code> and add your web config.</li>
            <li>Deploy rules and Cloud Functions (<code className="font-mono text-xs">firebase deploy</code>) and set secrets for PayPal, OpenRouter, EmailJS and Backblaze.</li>
          </ol>
          <p className="mt-3">See <strong>README.md → Setup</strong> for the full checklist.</p>
        </>
      ),
      actions: <Button variant="primary" icon={<FlaskConical className="size-4" />} onClick={() => requestMode("demo")}>Explore Demo Mode</Button>,
    },
    guest: {
      icon: KeyRound,
      title: "Sign in to use Real Mode",
      body: <p>You're exploring as a guest. Real Mode works with your organization's actual data, so it requires an account. Demo data is never carried over.</p>,
      actions: (
        <>
          <Button variant="primary" onClick={() => nav("/login")}>Sign in</Button>
          <Button onClick={() => nav("/register")}>Create account</Button>
          <Button variant="ghost" onClick={() => requestMode("demo")}>Back to Demo</Button>
        </>
      ),
    },
    email_unverified: {
      icon: MailCheck,
      title: "Verify your email to continue",
      body: <p>We sent a verification link to <strong>{user?.email}</strong>. Verified email is required before PayPilot can access real financial data.</p>,
      actions: (
        <>
          <Button variant="primary" onClick={() => reloadUser().then(() => toast.info("Checked verification status")).catch((e) => toast.error("Couldn't refresh", errorMessage(e)))}>I've verified</Button>
          <Button onClick={() => resendVerification().then(() => toast.success("Verification email sent")).catch((e) => toast.error("Couldn't send", errorMessage(e)))}>Resend email</Button>
        </>
      ),
    },
    no_org: {
      icon: Building2,
      title: "Create your organization",
      body: <p>Real Mode is scoped to an organization: its own settings, PayPal connection, customers, invoices and team. Create one to get started — you can connect PayPal Sandbox right after.</p>,
      actions: (
        <>
          <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={() => nav("/onboarding")}>Set up organization</Button>
          <Button variant="ghost" onClick={() => requestMode("demo")}>Back to Demo</Button>
        </>
      ),
    },
  }[realBlocker];
  const I = content.icon;
  return (
    <div className="max-w-2xl mx-auto py-10">
      <Card className="p-6 sm:p-8">
        <div className="grid grid-cols-1 place-items-center size-11 rounded-xl bg-accent-soft text-accent mb-4"><I className="size-5" /></div>
        <h1 className="text-lg font-semibold">{content.title}</h1>
        <div className="mt-2 text-sm text-muted leading-relaxed">{content.body}</div>
        <div className="mt-6 flex flex-wrap gap-2">{content.actions}</div>
      </Card>
    </div>
  );
}

/** Banner for money pages in Real Mode when PayPal isn't connected yet. */
export function PayPalBanner() {
  const { mode, paypalState, can } = useWorkspace();
  if (mode === "demo" || paypalState !== "not_connected") return null;
  return (
    <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-4 py-3">
      <PlugZap className="size-4 text-sky-300 shrink-0" />
      <p className="text-sm text-muted flex-1">
        <strong className="text-fg font-medium">PayPal isn't connected.</strong> Showing only records created in PayPilot. Connect PayPal Sandbox to sync transactions, invoices and subscriptions.
      </p>
      {can("integrations.manage") && (
        <Link to="/integrations" className="text-sm font-medium text-sky-300 hover:text-sky-200 inline-flex items-center gap-1">Connect PayPal <ArrowRight className="size-3.5" /></Link>
      )}
    </div>
  );
}

export function SandboxNote() {
  const { mode, paypalState } = useWorkspace();
  if (mode !== "real" || paypalState !== "sandbox") return null;
  return (
    <div className="mb-5 flex items-center gap-2 text-xs text-sky-300/90">
      <ShieldCheck className="size-3.5" /> PayPal <strong>Sandbox</strong>: operations use test money in PayPal's sandbox environment.
    </div>
  );
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can, member, mode } = useWorkspace();
  if (mode === "real" && !member) return <FullPageLoader label="Checking access…" />;
  if (!can(permission))
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="mx-auto grid grid-cols-1 place-items-center size-11 rounded-xl border border-line bg-surface-2 text-muted mb-3"><Lock className="size-5" /></div>
        <h1 className="text-base font-semibold">You don't have access to this page</h1>
        <p className="text-sm text-muted mt-1">Your role is missing the “{permission}” permission. Ask an owner or administrator to update your role.</p>
      </div>
    );
  return <>{children}</>;
}
