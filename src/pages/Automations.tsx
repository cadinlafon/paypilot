import { useState } from "react";
import { Plus, Workflow, Play, FlaskConical, Pencil, RotateCw, ChevronRight, AlertTriangle, ListChecks, Check, Archive, Zap } from "lucide-react";
import { useActive, useCollection, useWorkspace } from "@/context/WorkspaceContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Form";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { Drawer, ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { AutomationBuilder } from "./automations/AutomationBuilder";
import { actionDef, triggerDef } from "@shared/automations";
import { formatDate } from "@shared/dates";
import type { Automation, AutomationRun } from "@shared/types";
import { errorMessage, relativeTime } from "@/lib/utils";

export default function Automations() {
  const { can, repo, mode, org } = useWorkspace();
  const { rows, loading } = useActive("automations");
  const runs = useCollection("automationRuns").rows;
  const tasks = useActive("tasks").rows;
  const toast = useToast();
  const [tab, setTab] = useState<"workflows" | "history" | "errors" | "tasks">("workflows");
  const [editing, setEditing] = useState<Automation | null | "new">(null);
  const [archiving, setArchiving] = useState<Automation | null>(null);
  const [runOpen, setRunOpen] = useState<AutomationRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tz = org?.timezone ?? "UTC";
  const editable = can("automations.configure");
  const errors = runs.filter((r) => r.status === "failed" || r.status === "partial");

  const run = async (a: Automation, test: boolean) => {
    if (!repo) return;
    setBusy(a.id + test);
    try {
      const r = await repo.runAutomation(a.id, { test });
      toast[test || mode === "demo" ? "demo" : r.status === "failed" ? "error" : "success"](test ? "Test run complete" : "Automation ran", `${r.steps.length} step(s) · ${r.status.replace("_", " ")}`);
      setRunOpen(r);
    } catch (e) {
      toast.error("Run failed", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const retry = async (r: AutomationRun) => {
    if (!repo) return;
    setBusy(r.id);
    try {
      const n = await repo.retryAutomationRun(r.id);
      toast[n.status === "failed" ? "error" : "success"]("Retry finished", n.status.replace("_", " "));
      setRunOpen(n);
    } catch (e) {
      toast.error("Retry failed", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const RunRow = ({ r }: { r: AutomationRun }) => (
    <li>
      <button onClick={() => setRunOpen(r)} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-2">
        <StatusBadge status={r.status} />
        <span className="min-w-0 flex-1"><span className="block text-sm truncate">{r.automationName}</span><span className="block text-xs text-muted truncate">{r.triggerSummary}{r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}</span></span>
        {r.test && <Badge tone="violet">test</Badge>}
        <span className="text-xs text-faint shrink-0 hidden sm:block">{relativeTime(r.triggeredAt)}</span>
        <ChevronRight className="size-4 text-faint" />
      </button>
    </li>
  );

  return (
    <div>
      <PageHeader title="Automations" description="Workflows that react to your business events. External actions are queued for approval — never sent silently." actions={editable && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>New automation</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[{ id: "workflows", label: "Workflows", count: rows.length }, { id: "history", label: "Execution history", count: runs.length }, { id: "errors", label: "Error log", count: errors.length }, { id: "tasks", label: "Tasks", count: tasks.filter((t) => t.status === "open").length }]} />
      {tab === "workflows" && (loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : rows.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((a) => {
            const t = triggerDef(a.trigger.type);
            return (
              <Card key={a.id} className="flex flex-col">
                <div className="flex items-start gap-3 p-5 pb-3">
                  <span className={`grid place-items-center size-9 rounded-xl shrink-0 ${a.enabled ? "bg-accent-soft text-accent" : "bg-surface-3 text-faint"}`}><Workflow className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><h3 className="text-sm font-semibold">{a.name}</h3>{a.testMode && <Badge tone="violet">Test mode</Badge>}{a.errorCount > 0 && <Badge tone="red">{a.errorCount} error(s)</Badge>}</div>
                    <p className="text-xs text-muted mt-0.5 line-clamp-2">{a.description}</p>
                  </div>
                  <Switch checked={a.enabled} disabled={!editable} onChange={async (v) => { try { await repo!.update("automations", a.id, { enabled: v }); toast.success(v ? "Automation enabled" : "Automation disabled"); } catch (e) { toast.error("Couldn't update", errorMessage(e)); } }} label={`Enable ${a.name}`} />
                </div>
                <div className="px-5 flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge tone="green"><Zap className="size-3" />{t.label}</Badge>
                  {a.conditions.length > 0 && <><ChevronRight className="size-3 text-faint" /><Badge tone="blue">{a.conditions.length} condition(s)</Badge></>}
                  <ChevronRight className="size-3 text-faint" />
                  {a.actions.map((x) => <Badge key={x.id} tone={actionDef(x.type).external ? "amber" : "violet"}>{actionDef(x.type).label}</Badge>)}
                </div>
                <div className="mt-auto flex items-center gap-2 px-5 py-3 mt-4 border-t border-line text-xs text-muted">
                  <span className="flex-1">{a.runCount} run(s){a.lastRunAt ? ` · last ${relativeTime(a.lastRunAt)}` : ""}</span>
                  {editable && (
                    <>
                      <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3.5" />} loading={busy === a.id + "true"} onClick={() => run(a, true)}>Test</Button>
                      <Button size="sm" variant="ghost" icon={<Play className="size-3.5" />} loading={busy === a.id + "false"} onClick={() => run(a, false)} disabled={!a.enabled} title="Run now with a sample event">Run</Button>
                      <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(a)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setArchiving(a)} aria-label="Archive"><Archive className="size-3.5" /></Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><EmptyState icon={<Workflow className="size-5" />} title="No automations yet" description="Start with an overdue-invoice reminder or a morning briefing." action={editable && <Button variant="primary" size="sm" onClick={() => setEditing("new")}>Create automation</Button>} /></Card>
      ))}
      {tab === "history" && <Card>{runs.length ? <ul className="divide-y divide-line">{runs.slice(0, 200).map((r) => <RunRow key={r.id} r={r} />)}</ul> : <EmptyState title="No runs yet" />}</Card>}
      {tab === "errors" && (
        <Card>
          {errors.length ? (
            <ul className="divide-y divide-line">
              {errors.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <AlertTriangle className="size-4 text-rose-300 shrink-0" />
                  <button onClick={() => setRunOpen(r)} className="min-w-0 flex-1 text-left"><span className="block text-sm truncate">{r.automationName}</span><span className="block text-xs text-rose-200/80 truncate">{r.error}</span></button>
                  <span className="text-xs text-faint hidden sm:block">{formatDate(r.triggeredAt, tz, true)}</span>
                  {editable && <Button size="sm" icon={<RotateCw className="size-3.5" />} loading={busy === r.id} onClick={() => retry(r)}>Retry</Button>}
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Check className="size-5 text-accent" />} title="No errors" description="Failed steps will appear here with retry controls." />}
        </Card>
      )}
      {tab === "tasks" && (
        <Card>
          <CardHeader title="Internal tasks" subtitle="Created by automations and the AI assistant" icon={<ListChecks className="size-4" />} />
          <CardBody>
            {tasks.length ? (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <input type="checkbox" className="size-4 accent-[#10b981]" checked={t.status === "done"} onChange={(e) => repo!.update("tasks", t.id, { status: e.target.checked ? "done" : "open" })} aria-label={`Mark ${t.title} done`} />
                    <span className={`flex-1 text-sm ${t.status === "done" ? "line-through text-faint" : ""}`}>{t.title}<span className="block text-xs text-muted">{t.description}</span></span>
                    {t.dueDate && <span className="text-xs text-muted">Due {formatDate(t.dueDate, tz)}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No tasks.</p>}
          </CardBody>
        </Card>
      )}
      <AutomationBuilder open={editing !== null} automation={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!archiving} onClose={() => setArchiving(null)} danger title={`Archive “${archiving?.name}”?`} description="It stops running. Its execution history is kept." confirmLabel="Archive" onConfirm={async () => { try { await repo!.archive("automations", archiving!.id); toast.success("Automation archived"); } catch (e) { toast.error("Couldn't archive", errorMessage(e)); } setArchiving(null); }} />
      {runOpen && (
        <Drawer open onClose={() => setRunOpen(null)} title={runOpen.automationName} subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={runOpen.status} />{formatDate(runOpen.triggeredAt, tz, true)}</span>} footer={editable && (runOpen.status === "failed" || runOpen.status === "partial") && <Button icon={<RotateCw className="size-4" />} loading={busy === runOpen.id} onClick={() => retry(runOpen)}>Retry</Button>}>
          <p className="text-sm text-muted">{runOpen.triggerSummary}</p>
          {runOpen.test && <p className="mt-2 text-xs text-violet-300">Test run — every action was simulated and nothing was created.</p>}
          <ol className="mt-5 space-y-3">
            {runOpen.steps.map((s, i) => (
              <li key={i} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2"><span className="text-xs text-faint tabular">{i + 1}.</span><span className="text-sm flex-1">{actionDef(s.type).label}</span><StatusBadge status={s.status} /></div>
                <p className="mt-1.5 text-xs text-muted pl-5">{s.detail}</p>
              </li>
            ))}
            {!runOpen.steps.length && <p className="text-sm text-muted">No actions ran (conditions not met).</p>}
          </ol>
          {runOpen.error && <p className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-200">{runOpen.error}</p>}
        </Drawer>
      )}
    </div>
  );
}
