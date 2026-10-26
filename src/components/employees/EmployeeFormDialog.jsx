import EmployeeRemovalAction from './EmployeeRemovalAction';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from "react";
import { erp } from "@/api/erpClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { ROLE_DEFINITIONS, normalizeRole } from "@/lib/permissions";
import RoleInfo from './RoleInfo';
import { usesClerk } from "@/lib/auth-provider";
import { inviteEmployee } from "@/lib/staff-invitations-client";
import {notifyRoleChanges} from '@/lib/role-permission-sync';
import { Save } from "lucide-react";

const EMPTY = {
  full_name: "", job_title: "", role: "", responsibilities: "", phone: "", email: "",
  contract_type: "permanent", base_salary: 0, payment_method: "bank_transfer", status: "active",
  user_id: "", user_email: "", bonus_plan: "", monthly_customer_target: "", monthly_supply_target: "",
  commission_rate_percent: "", new_customer_bonus: "",
};

const CONTRACTS = ["permanent", "temporary", "daily", "intern", "contractor"];
const STATUSES = ["active", "on_leave", "suspended", "terminated"];

export default function EmployeeFormDialog({ open, onOpenChange, employee, employees, onSaved, roleDefinitions = ROLE_DEFINITIONS }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const pending=useRef(false);
  const [form, setForm] = useState(EMPTY);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sendInvitation, setSendInvitation] = useState(usesClerk());
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(employee ? { ...EMPTY, ...employee, role: roleDefinitions.some(def => def.key === employee.role) ? employee.role : normalizeRole(employee.role) || employee.role } : EMPTY);
    setSendInvitation(usesClerk() && !employee);
    let active=true;erp.entities.User.list().then(res => {if(active)setUsers(Array.isArray(res) ? res : res?.items || []);}).catch(()=>{if(active)setUsers([]);});return()=>{active=false;};
  }, [open, employee?.id]);

  const dutiesOf = (key) => (roleDefinitions.find(def => def.key === key)?.duties || []).join(' · ');

  const definitionOf = key => roleDefinitions.find(def => def.key === key);
  const set = (field) => (value) => setForm(f => ({ ...f, [field]: value }));

  // Picking a role prefills its standard duties, without wiping a custom description.
  const changeRole = (key) => setForm(f => {
    const previousDefault = f.role ? dutiesOf(f.role) : "";
    const keepCustom = f.responsibilities && f.responsibilities !== previousDefault;
    return { ...f, role: key, responsibilities: keepCustom ? f.responsibilities : dutiesOf(key),...(!employee&&(key==='hotesse'||definitionOf(key)?.template_role==='hotesse')&&f.contract_type==='permanent'?{contract_type:'temporary'}:{}) };
  });

  // A profile edit must always be saveable: the role is only written when it is a real system role.
  const valid = form.full_name.trim() && form.job_title.trim() && (employee || definitionOf(form.role))
    && (!sendInvitation || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()));

  const save = async () => {
    if (!valid || pending.current) return;
    if ((form.commission_rate_percent !== '' && form.commission_rate_percent != null && (!Number.isFinite(Number(form.commission_rate_percent)) || Number(form.commission_rate_percent) < 0 || Number(form.commission_rate_percent) > 100)) || (form.new_customer_bonus !== '' && form.new_customer_bonus != null && (!Number.isFinite(Number(form.new_customer_bonus)) || Number(form.new_customer_bonus) < 0 || Number(form.new_customer_bonus) > 1e9))) {
      toast({ variant: "destructive", title: ui("Use a commission rate from 0 to 100% and a non-negative customer bonus") }); return;
    }
    const customerTarget = Number(form.monthly_customer_target), supplyTarget = Number(form.monthly_supply_target);
    if ((form.monthly_customer_target != null && form.monthly_customer_target !== "" && (!Number.isSafeInteger(customerTarget) || customerTarget < 0 || customerTarget > 1000000)) || (form.monthly_supply_target != null && form.monthly_supply_target !== "" && (!Number.isFinite(supplyTarget) || supplyTarget < 0 || supplyTarget > 1e12))) {
      toast({ variant: "destructive", title: ui("Enter valid non-negative monthly goals") }); return;
    }
    pending.current=true;setSaving(true);
    const linked = users.find(u => u.id === form.user_id);
    const payload = {
      full_name: form.full_name.trim(),
      job_title: form.job_title.trim(),
      ...(definitionOf(form.role) ? { role: form.role } : {}),
      responsibilities: form.responsibilities,
      bonus_plan: form.bonus_plan,
      commission_rate_percent: form.commission_rate_percent === '' || form.commission_rate_percent == null ? null : Number(form.commission_rate_percent),
      new_customer_bonus: form.new_customer_bonus === '' || form.new_customer_bonus == null ? null : Number(form.new_customer_bonus),
      monthly_customer_target: form.monthly_customer_target === "" || form.monthly_customer_target == null ? null : Number(form.monthly_customer_target),
      monthly_supply_target: form.monthly_supply_target === "" || form.monthly_supply_target == null ? null : Number(form.monthly_supply_target),
      phone: form.phone,
      email: form.email,
      contract_type: form.contract_type,
      base_salary: Number(form.base_salary) || 0,
      payment_method: form.payment_method,
      status: form.status,
      user_id: form.user_id,
      user_email: linked?.email || "",
    };
    try {
      const saved = employee?.id
        ? await erp.entities.Employee.update(employee.id, payload)
        : await erp.entities.Employee.create({
          ...payload,
          employee_number: `E-${String(employees.length + 1).padStart(4, "0")}`,
          start_date: new Date().toISOString().split("T")[0],
        });
      if(!employee || ['role','user_id','status'].some(key=>Object.hasOwn(payload,key)&&payload[key]!==employee[key]))notifyRoleChanges();
      let invitation = null, inviteError = null;
      if (sendInvitation) {
        try { invitation = await inviteEmployee(saved.id); }
        catch (error) { inviteError = error; }
      }
      toast(inviteError
        ? { variant: 'destructive', title: ui("Employee saved, but invitation was not sent"), description: inviteError.message + ' Use Invite / check account in the employee action menu to retry.' }
        : { title: invitation?.status === 'invited' ? ui("Employee created and invitation sent") : invitation?.status === 'pending' ? ui("Employee saved; invitation already pending") : invitation?.status === 'existing_account' || invitation?.status === 'linked' ? ui("Employee saved; account can sign in") : employee ? ui("Employee updated") : ui("Employee created") });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ variant: "destructive", title: ui("Could not save employee"), description: String(e?.message || e) });
    } finally {
      pending.current=false;setSaving(false);
    }
  };

  const currentRole = definitionOf(form.role);
  const legacyRole = form.role && !currentRole ? form.role : null;

  return (
    <Dialog open={open} onOpenChange={value=>{if(!pending.current)onOpenChange(value);}}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? ui("Edit Employee") : ui("New Employee")}</DialogTitle>
          <DialogDescription>{ui("Set the role and responsibilities that decide this person's access.")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{ui("Full Name *")}</Label>
            <Input value={form.full_name} onChange={e => set("full_name")(e.target.value)} />
          </div>
          <div>
            <Label>{ui("Job Title *")}</Label>
            <Input value={form.job_title} onChange={e => set("job_title")(e.target.value)} placeholder={ui("e.g. Salesperson, Driver")} />
          </div>
          <div>
            <div className="flex items-center gap-1"><Label>{ui("System Role *")}</Label><RoleInfo role={currentRole} /></div>
            <Select value={form.role} onValueChange={changeRole}>
              <SelectTrigger><SelectValue placeholder={ui("Select a role")} /></SelectTrigger>
              <SelectContent>
                {legacyRole && <SelectItem value={legacyRole}>{legacyRole}{ui(" (not a system role)")}</SelectItem>}
                {roleDefinitions.map(r => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>{ui("Responsibilities")}</Label>
            <Textarea
              rows={3}
              value={form.responsibilities}
              onChange={e => set("responsibilities")(e.target.value)}
              placeholder={currentRole ? currentRole.summary : ui("Prefilled from the role — adjust if needed")}
            />
          </div>

          {form.role === 'commercial' && <div className="col-span-2">
            <div className="mb-4 grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-medium">{ui("Monthly verified new customers")}<Input type="number" min="0" max="1000000" step="1" value={form.monthly_customer_target ?? ''} onChange={e => set("monthly_customer_target")(e.target.value)} placeholder={ui("No target")} /></label><label className="space-y-1 text-xs font-medium">{ui("Monthly approved supplies (FCFA, incl. tax)")}<Input type="number" min="0" max="1000000000000" step="0.01" value={form.monthly_supply_target ?? ''} onChange={e => set("monthly_supply_target")(e.target.value)} placeholder={ui("No target")} /></label></div>
            <Label htmlFor="commercial-bonus-plan">{ui("Agreed bonus plan")}</Label>
            <div className="mb-4 grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-medium">{ui("Commission on net sales to acquired customers (%)")}<Input type="number" min="0" max="100" step="0.01" value={form.commission_rate_percent ?? ''} onChange={e => set('commission_rate_percent')(e.target.value)} placeholder={ui("Not configured")} /></label><label className="space-y-1 text-xs font-medium">{ui("Bonus per verified new customer (FCFA)")}<Input type="number" min="0" max="1000000000" step="0.01" value={form.new_customer_bonus ?? ''} onChange={e => set('new_customer_bonus')(e.target.value)} placeholder={ui("Not configured")} /></label></div>
            <Textarea id="commercial-bonus-plan" value={form.bonus_plan || ''} maxLength={2000} rows={3} onChange={e => set("bonus_plan")(e.target.value)} placeholder={ui("Record the agreed rates, targets, qualifying sales and review period.")} />
            <p className="mt-1 text-xs text-slate-500">{ui("Dashboard estimates use current rates and monthly posted net sales, including credit, plus verified acquisitions. Free replacements and tax are excluded. Payment requires management review; changing rates recalculates the estimate.")}</p>
          </div>}
          <div className="col-span-2">
            <Label>{ui("Linked user account")}</Label>
            <Select value={form.user_id || "none"} onValueChange={v => set("user_id")(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder={ui("Not linked")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{ui("Not linked")}</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">{ui("Choose an existing ERP account, or leave this blank and invite the saved email. The verified login receives this employee's saved role.")}</p>
          </div>

          <div>
            <Label>{ui("Phone")}</Label>
            <Input value={form.phone} onChange={e => set("phone")(e.target.value)} />
          </div>
          <div>
            <Label>{ui("Email")}</Label>
            <Input type="email" value={form.email} onChange={e => set("email")(e.target.value)} />
          </div>
          <div>
            <Label>{ui("Contract Type")}</Label>
            <Select value={form.contract_type} onValueChange={set("contract_type")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Status")}</Label>
            <Select value={form.status} onValueChange={set("status")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Base Salary (XAF)")}</Label>
            <Input type="number" value={form.base_salary} onChange={e => set("base_salary")(e.target.value)} />
          </div>
          <div>
            <Label>{ui("Payment Method")}</Label>
            <Select value={form.payment_method} onValueChange={set("payment_method")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["bank_transfer", "mobile_money", "cash"].map(m => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {usesClerk() && !employee && <label className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><input type="checkbox" className="mt-1" checked={sendInvitation} onChange={event => setSendInvitation(event.target.checked)} /><span><strong>{ui("Send sign-up invitation after saving")}</strong><span className="mt-1 block text-xs text-slate-600">{ui("Clerk emails this employee. Their verified email links to the role selected above; they can only use that role's permitted features.")}</span></span></label>}

        <Button className="mt-4" onClick={save} disabled={!valid || saving}>
          <Save size={16} className="mr-1" /> {saving ? ui("Saving…") : employee ? ui("Save changes") : ui("Create employee")}
        </Button>
        {employee&&<div className="mt-4 border-t pt-3"><EmployeeRemovalAction employee={employee} onSaved={async()=>{await onSaved?.();onOpenChange(false);}}/></div>}
      </DialogContent>
    </Dialog>
  );
}
