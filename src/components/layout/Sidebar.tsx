import { NavLink } from "react-router-dom";
import { Check, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, X, FlaskConical } from "lucide-react";
import { NAV } from "./nav";
import { useWorkspace, useCollection } from "@/context/WorkspaceContext";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/Menu";
import { cn, initials } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#10b981" />
        <path d="M9 23V9h7.5a4.5 4.5 0 0 1 0 9H13" fill="none" stroke="#0b0d0e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 23l4-4" stroke="#0b0d0e" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight">PayPilot</span>}
    </div>
  );
}

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const { orgs, orgId, switchOrg, mode, org } = useWorkspace();
  const nav = useNavigate();
  const current = orgs.find((o) => o.id === orgId);
  return (
    <Menu
      className="w-64"
      trigger={({ toggle }) => (
        <button onClick={toggle} className={cn("w-full flex items-center gap-2.5 rounded-xl border border-line bg-surface-2 hover:border-line-strong transition-colors", collapsed ? "p-1.5 justify-center" : "px-2.5 py-2")} aria-label="Switch organization">
          <span className={cn("grid place-items-center size-7 rounded-lg text-[11px] font-bold shrink-0", mode === "demo" ? "bg-amber-500/15 text-amber-300" : "bg-accent-soft text-accent-strong")}>{initials(current?.name ?? org?.name ?? "—")}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium truncate">{current?.name ?? org?.name ?? "No organization"}</span>
                <span className="block text-[11px] text-muted">{mode === "demo" ? "Demo organization" : (current?.roleId ?? "member").replace(/_/g, " ")}</span>
              </span>
              <ChevronsUpDown className="size-4 text-faint" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>{mode === "demo" ? "Demo organizations" : "Your organizations"}</MenuLabel>
          {orgs.map((o) => (
            <MenuItem key={o.id} active={o.id === orgId} icon={mode === "demo" ? <FlaskConical className="size-4" /> : undefined} onClick={() => { switchOrg(o.id); close(); }}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">{o.name}</span>
                {o.id === orgId && <Check className="size-4 text-accent" />}
              </span>
            </MenuItem>
          ))}
          {mode === "real" && (
            <>
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Plus className="size-4" />} onClick={() => { close(); nav("/onboarding?new=1"); }}>Create organization</MenuItem>
            </>
          )}
        </>
      )}
    </Menu>
  );
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onMobileClose: () => void }) {
  const { can, mode } = useWorkspace();
  const unread = useCollection("notifications").rows.filter((n) => !n.read).length;
  const pending = useCollection("approvals").rows.filter((a) => a.status === "pending").length;
  const badge: Record<string, number> = { "/notifications": unread, "/assistant": pending };

  const content = (isMobile: boolean) => {
    const c = collapsed && !isMobile;
    return (
      <div className="flex h-full flex-col">
        <div className={cn("flex items-center h-14 px-3", c ? "justify-center" : "justify-between")}>
          <Logo collapsed={c} />
          {isMobile ? (
            <button onClick={onMobileClose} className="p-2 text-muted hover:text-fg" aria-label="Close menu"><X className="size-4" /></button>
          ) : (
            !c && <button onClick={onToggle} className="p-1.5 rounded-md text-faint hover:text-fg hover:bg-surface-2" aria-label="Collapse sidebar"><PanelLeftClose className="size-4" /></button>
          )}
        </div>
        <div className="px-3 pb-3"><OrgSwitcher collapsed={c} /></div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.permission || can(i.permission));
            if (!items.length) return null;
            return (
              <div key={g.group} className="mt-3 first:mt-0">
                {!c && <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{g.group}</div>}
                {c && <div className="mx-3 mb-2 h-px bg-line" />}
                <ul className="space-y-0.5">
                  {items.map((i) => (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        end={i.to === "/"}
                        onClick={isMobile ? onMobileClose : undefined}
                        title={c ? i.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            "group relative flex items-center gap-2.5 rounded-lg text-sm transition-colors",
                            c ? "justify-center h-9" : "px-2.5 h-9",
                            isActive ? "bg-surface-3 text-fg" : "text-muted hover:text-fg hover:bg-surface-2",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />}
                            <i.icon className={cn("size-4 shrink-0", isActive && "text-accent")} />
                            {!c && <span className="truncate">{i.label}</span>}
                            {!!badge[i.to] && (
                              <span className={cn("tabular text-[10px] font-semibold rounded-full bg-accent text-[#04140d] px-1.5 min-w-4 text-center leading-4", c ? "absolute top-1 right-1" : "ml-auto")}>{badge[i.to]}</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className={cn("border-t border-line p-3 text-[11px] text-faint", c && "text-center")}>
          {c ? (
            <button onClick={onToggle} className="p-1.5 rounded-md hover:text-fg hover:bg-surface-2" aria-label="Expand sidebar"><PanelLeftOpen className="size-4" /></button>
          ) : (
            <span>{mode === "demo" ? "Demo data is stored only in this browser." : "Business management tool — not audited accounting or tax advice."}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <aside className={cn("hidden lg:block shrink-0 border-r border-line bg-surface/60 sticky top-12 h-[calc(100dvh-3rem)] transition-[width] duration-200", collapsed ? "w-16" : "w-64")}>{content(false)}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onMobileClose} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-surface border-r border-line animate-slide-up">{content(true)}</aside>
        </div>
      )}
    </>
  );
}
