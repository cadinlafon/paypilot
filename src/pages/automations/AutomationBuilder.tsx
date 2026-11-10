import { useEffect, useState } from "react";
import { Plus, Trash2, Zap, Filter, Play, ArrowDown, ShieldAlert } from "lucide-react";
import type { Automation, AutomationAction, AutomationActionType, AutomationCondition, ConditionOperator, TriggerType } from "@shared/types";
import { ACTIONS, OPERATORS, TRIGGERS, actionDef, triggerDef } from "@shared/automations";
import { useWorkspace } from "@/context/WorkspaceContext";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Switch } from "@/components/ui/Form";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, uid } from "@/lib/utils";

export function AutomationBuilder({ open, onClose, automation }: { open: boolean; onClose: () => void; automation: Automation | null }) {
  const { repo, setDirty } = useWorkspace();
  const toast = useToast();
  const blank = () => ({
    name: automation?.name ?? "",
    description: automation?.description ?? "",
    trigger: automation?.trigger ?? { type: "payment_received" as TriggerType, config: {} as Record<string, string> },
    conditions: automation?.conditions ?? ([] as AutomationCondition[]),
    actions: automation?.actions ?? ([{ id: uid("a"), type: "create_notification", config: { title: "", body: "" } }] as AutomationAction[]),
    enabled: automation?.enabled ?? true,
    testMode: automation?.testMode ?? true,
  });
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank()); setTouched(false); } }, [open, automation?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDirty("automation-builder", open && touched); return () => setDirty("automation-builder", false); }, [open, touched, setDirty]);
  const upd = (p: Partial<typeof f>) => { setTouched(true); setF((s) => ({ ...s, ...p })); };
  const tdef = triggerDef(f.trigger.type);
  const err = !f.name.trim() ? "Name the automation" : !f.actions.length ? "Add at least one action" : f.conditions.some((c) => !c.field || c.value === "") ? "Complete or remove empty conditions" : null;
  const fields = tdef.fields.map((x) => x.key);
  const placeholders = [...fields, "customerEmail", "amountFormatted", "orgName"].filter((v, i, a) => a.indexOf(v) === i);

  const save = async () => {
    if (!repo || err) return;
    setBusy(true);
    const data = { name: f.name.trim(), description: f.description.trim(), trigger: f.trigger, conditions: f.conditions, actions: f.actions, enabled: f.enabled, testMode: f.testMode };
    try {
      if (automation) await repo.update("automations", automation.id, data);
      else await repo.create("automations", { ...data, source: "manual", runCount: 0, errorCount: 0, archivedAt: null } as any);
      toast.success(automation ? "Automation saved" : "Automation created", f.testMode ? "Test mode is on — actions are simulated until you turn it off." : undefined);
      setTouched(false);
      onClose();
    } catch (e) {
      toast.error("Couldn't save automation", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const Node = ({ icon, color, label, children }: { icon: React.ReactNode; color: string; label: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-line bg-surface-2/40">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <span className={`grid place-items-center size-6 rounded-md ${color}`}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
  const Arrow = () => <div className="flex justify-center py-1.5 text-faint"><ArrowDown className="size-4" /></div>;

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={automation ? "Edit automation" : "New automation"} description="Trigger → Condition → Action. External actions always wait for human approval." footer={<>{touched && err && <p className="text-xs text-rose-300 sm:mr-auto self-center">{err}</p>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!err} onClick={save}>Save automation</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-5">
        <Field label="Name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => upd({ name: e.target.value })} maxLength={80} placeholder="e.g. Overdue invoice reminder" />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={f.description} onChange={(e) => upd({ description: e.target.value })} maxLength={200} />}</Field>
      </div>

      <Node icon={<Zap className="size-3.5" />} color="bg-accent-soft text-accent" label="When (trigger)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select aria-label="Trigger" value={f.trigger.type} onChange={(e) => upd({ trigger: { type: e.target.value as TriggerType, config: {} }, conditions: [] })}>
            {TRIGGERS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </Select>
          <p className="text-xs text-muted self-center">{tdef.description}</p>
          {tdef.configFields?.map((cf) => (
            <Field key={cf.key} label={cf.label}>{(id) => <Input id={id} value={f.trigger.config[cf.key] ?? ""} placeholder={cf.placeholder} onChange={(e) => upd({ trigger: { ...f.trigger, config: { ...f.trigger.config, [cf.key]: e.target.value } } })} />}</Field>
          ))}
        </div>
      </Node>
      <Arrow />
      <Node icon={<Filter className="size-3.5" />} color="bg-sky-500/15 text-sky-300" label="Only if (conditions)">
        {f.conditions.length === 0 && <p className="text-sm text-muted mb-3">Runs every time the trigger fires.</p>}
        <div className="space-y-2">
          {f.conditions.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
              <Select aria-label="Field" value={c.field} onChange={(e) => upd({ conditions: f.conditions.map((x) => (x.id === c.id ? { ...x, field: e.target.value } : x)) })}>{tdef.fields.map((fd) => <option key={fd.key} value={fd.key}>{fd.label}</option>)}</Select>
              <Select aria-label="Operator" value={c.operator} onChange={(e) => upd({ conditions: f.conditions.map((x) => (x.id === c.id ? { ...x, operator: e.target.value as ConditionOperator } : x)) })}>{OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
              <Input aria-label="Value" value={c.value} placeholder={tdef.fields.find((x) => x.key === c.field)?.kind === "money" ? "Amount, e.g. 500" : "Value"} onChange={(e) => upd({ conditions: f.conditions.map((x) => (x.id === c.id ? { ...x, value: e.target.value } : x)) })} />
              <button className="p-1.5 text-faint hover:text-rose-300" onClick={() => upd({ conditions: f.conditions.filter((x) => x.id !== c.id) })} aria-label="Remove condition"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => upd({ conditions: [...f.conditions, { id: uid("c"), field: tdef.fields[0].key, operator: "gt", value: "" }] })}>Add condition</Button>
        <p className="text-[11px] text-faint mt-1">Money conditions compare amounts in major units of the reporting currency. All conditions must match.</p>
      </Node>
      <Arrow />
      <Node icon={<Play className="size-3.5" />} color="bg-violet-500/15 text-violet-300" label="Then (actions)">
        <div className="space-y-3">
          {f.actions.map((a, idx) => {
            const def = actionDef(a.type);
            return (
              <div key={a.id} className="rounded-xl border border-line bg-bg/50 p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-faint tabular w-5">{idx + 1}.</span>
                  <Select aria-label="Action" value={a.type} onChange={(e) => upd({ actions: f.actions.map((x) => (x.id === a.id ? { ...x, type: e.target.value as AutomationActionType, config: {} } : x)) })} className="flex-1">{ACTIONS.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}</Select>
                  {def.external && <Badge tone="amber"><ShieldAlert className="size-3" />Needs approval</Badge>}
                  <button className="p-1.5 text-faint hover:text-rose-300" onClick={() => upd({ actions: f.actions.filter((x) => x.id !== a.id) })} aria-label="Remove action"><Trash2 className="size-4" /></button>
                </div>
                <p className="text-xs text-muted mb-3">{def.description}</p>
                <div className="grid grid-cols-1 gap-3">
                  {def.configFields.map((cf) => (
                    <Field key={cf.key} label={cf.label}>
                      {(id) => (cf.multiline ? <Textarea id={id} value={a.config[cf.key] ?? ""} placeholder={cf.placeholder} onChange={(e) => upd({ actions: f.actions.map((x) => (x.id === a.id ? { ...x, config: { ...x.config, [cf.key]: e.target.value } } : x)) })} className="min-h-16" /> : <Input id={id} value={a.config[cf.key] ?? ""} placeholder={cf.placeholder} onChange={(e) => upd({ actions: f.actions.map((x) => (x.id === a.id ? { ...x, config: { ...x.config, [cf.key]: e.target.value } } : x)) })} />)}
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => upd({ actions: [...f.actions, { id: uid("a"), type: "create_task", config: {} }] })}>Add action</Button>
        <p className="text-[11px] text-faint mt-1">Placeholders: {placeholders.map((p) => `{{${p}}}`).join(" ")}</p>
      </Node>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm">Enabled</div><div className="text-xs text-muted">Responds to real triggers</div></div><Switch checked={f.enabled} onChange={(v) => upd({ enabled: v })} label="Enabled" /></div>
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm">Test mode</div><div className="text-xs text-muted">Simulate all actions; create nothing</div></div><Switch checked={f.testMode} onChange={(v) => upd({ testMode: v })} label="Test mode" /></div>
      </div>
    </Dialog>
  );
}
