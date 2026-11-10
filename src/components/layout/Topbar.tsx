import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, LogOut, Menu as MenuIcon, Search, Settings, ShieldAlert, User as UserIcon, Activity, FileText, Users, Boxes, CornerDownLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Dialog } from "@/components/ui/Dialog";
import { formatMoney } from "@shared/money";
import { ALL_NAV } from "./nav";
import { ApprovalCenter } from "../approvals/ApprovalCenter";
import { cn, initials } from "@/lib/utils";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const { member, mode } = useWorkspace();
  const nav = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const unread = useCollection("notifications").rows.filter((n) => !n.read).length;
  const pending = useCollection("approvals").rows.filter((a) => a.status === "pending").length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <header className="sticky top-12 z-20 flex items-center gap-2 h-14 px-3 sm:px-6 border-b border-line bg-bg/85 backdrop-blur">
      <button onClick={onMenu} className="lg:hidden p-2 -ml-1 text-muted hover:text-fg" aria-label="Open menu"><MenuIcon className="size-5" /></button>
      <button onClick={() => setSearchOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 h-9 max-w-md rounded-lg border border-line bg-surface-2 px-3 text-sm text-faint hover:border-line-strong transition-colors" aria-label="Search">
        <Search className="size-4" />
        <span className="flex-1 text-left truncate"><span className="sm:hidden">Search…</span><span className="hidden sm:inline">Search customers, invoices, transactions…</span></span>
        <kbd className="hidden sm:inline text-[10px] font-mono border border-line rounded px-1.5 py-0.5">⌘K</kbd>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button onClick={() => setApprovalsOpen(true)} className="relative p-2 rounded-lg text-muted hover:text-fg hover:bg-surface-2" aria-label={`Pending approvals (${pending})`} title="Pending approvals">
          <ShieldAlert className="size-[18px]" />
          {pending > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-amber-400 text-[10px] font-bold text-black grid grid-cols-1 place-items-center tabular">{pending}</span>}
        </button>
        <button onClick={() => nav("/notifications")} className="relative p-2 rounded-lg text-muted hover:text-fg hover:bg-surface-2" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent ring-2 ring-bg" />}
        </button>
        <Menu
          align="right"
          className="w-64"
          trigger={({ toggle }) => (
            <button onClick={toggle} className="ml-1 grid grid-cols-1 place-items-center size-8 rounded-full bg-surface-3 border border-line text-xs font-semibold hover:border-line-strong" aria-label="Account menu">
              {user?.photoURL ? <img src={user.photoURL} alt="" className="size-8 rounded-full" /> : initials(user?.displayName ?? "")}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-2.5 py-2">
                <div className="text-sm font-medium truncate">{user?.displayName}</div>
                <div className="text-xs text-muted truncate">{user?.email}</div>
                <div className="mt-1.5 text-[11px] text-faint">
                  {user?.isGuest ? "Guest session (Demo only)" : `Role: ${(member?.roleId ?? "—").replace(/_/g, " ")}`} · {mode === "demo" ? "Demo" : "Real"}
                </div>
              </div>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<UserIcon className="size-4" />} onClick={() => { close(); nav("/settings?tab=profile"); }}>Profile</MenuItem>
              <MenuItem icon={<Settings className="size-4" />} onClick={() => { close(); nav("/settings"); }}>Settings</MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<LogOut className="size-4" />} onClick={() => { close(); logout().then(() => nav("/login")); }}>Sign out</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ApprovalCenter open={approvalsOpen} onClose={() => setApprovalsOpen(false)} />
    </header>
  );
}

function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { can, org } = useWorkspace();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const customers = useCollection("customers").rows;
  const invoices = useCollection("invoices").rows;
  const txs = useCollection("transactions").rows;
  const products = useCollection("products").rows;
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out: { group: string; label: string; sub?: string; to: string; icon: typeof Users }[] = [];
    for (const n of ALL_NAV) if ((!n.permission || can(n.permission)) && (!s || n.label.toLowerCase().includes(s))) out.push({ group: "Pages", label: n.label, to: n.to, icon: n.icon as typeof Users });
    if (s.length >= 2) {
      if (can("customers.view")) customers.filter((c) => !c.archivedAt && [c.name, c.email, c.company ?? ""].some((x) => x.toLowerCase().includes(s))).slice(0, 5).forEach((c) => out.push({ group: "Customers", label: c.name, sub: c.company ?? c.email, to: `/customers/${c.id}`, icon: Users }));
      if (can("invoices.view")) invoices.filter((i) => !i.archivedAt && (i.number.toLowerCase().includes(s) || i.customerName.toLowerCase().includes(s))).slice(0, 5).forEach((i) => out.push({ group: "Invoices", label: i.number, sub: `${i.customerName} · ${formatMoney(i.totals.total, i.currency)} · ${i.status}`, to: `/invoices?open=${i.id}`, icon: FileText }));
      if (can("transactions.view")) txs.filter((t) => (t.externalId ?? "").toLowerCase().includes(s) || t.customerName.toLowerCase().includes(s) || t.description.toLowerCase().includes(s)).slice(0, 5).forEach((t) => out.push({ group: "Transactions", label: `${t.customerName} — ${formatMoney(t.gross, t.currency)}`, sub: `${t.description} · ${new Date(t.date).toLocaleDateString("en-US", { timeZone: org?.timezone })}`, to: `/transactions?open=${t.id}`, icon: Activity }));
      if (can("products.view")) products.filter((p) => !p.archivedAt && p.name.toLowerCase().includes(s)).slice(0, 4).forEach((p) => out.push({ group: "Products", label: p.name, sub: formatMoney(p.price, p.currency), to: `/products?open=${p.id}`, icon: Boxes }));
    }
    return out.slice(0, 20);
  }, [q, customers, invoices, txs, products, can, org]);
  const go = (to: string) => {
    onClose();
    nav(to);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Search" size="lg">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && results[sel]) go(results[sel].to);
        }}
        placeholder="Type a customer, invoice number, PayPal transaction ID…"
        className="w-full h-11 rounded-xl border border-line-strong bg-surface-2 px-4 text-sm focus:outline-none focus:border-accent/60"
        aria-label="Search query"
      />
      <ul className="mt-3 max-h-[50vh] overflow-y-auto">
        {results.map((r, i) => (
          <li key={r.group + r.to + i}>
            {(i === 0 || results[i - 1].group !== r.group) && <div className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wider text-faint">{r.group}</div>}
            <button onMouseEnter={() => setSel(i)} onClick={() => go(r.to)} className={cn("w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left", i === sel ? "bg-surface-3" : "hover:bg-surface-2")}>
              <r.icon className="size-4 text-muted shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate">{r.label}</span>
                {r.sub && <span className="block text-xs text-muted truncate">{r.sub}</span>}
              </span>
              {i === sel && <CornerDownLeft className="size-3.5 text-faint" />}
            </button>
          </li>
        ))}
        {!results.length && <li className="py-8 text-center text-sm text-muted">No results for “{q}”</li>}
      </ul>
    </Dialog>
  );
}
