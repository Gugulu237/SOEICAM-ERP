
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useMemo } from "react";
import { DashboardIdentity } from '@/components/home/DashboardIdentity';
import CashierWorkspace from '@/components/cashier/CashierWorkspace';
import { Link, useSearchParams } from '@/lib/router';
import { erp } from "@/api/erpClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { prepareCashDisbursement } from "@/lib/purchase-payments";
import CashCollections from "@/components/cashier/CashCollections";
import DailyCashReceived from "@/components/cashier/DailyCashReceived";
import DisbursementRequests from "@/components/cashier/DisbursementRequests";
import PettyCashPanel from "@/components/cashier/PettyCashPanel";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Banknote, Clock, CheckCircle2, DollarSign } from "lucide-react";

export default function CashierDashboard() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role, roleLabel, employee, user, loading } = useCurrentUser();
  const [params] = useSearchParams();
  if (loading) return <p role="status" className="p-8 text-slate-500">{ui("Loading cash desk...")}</p>;
  if (role === 'production_manager' || params.get('view') === 'cheques') return <><Link to="/cashier" className="mb-4 inline-block text-sm text-emerald-800 underline">{ui("Back to cash workspace")}</Link><ChequeDesk /></>;
  return <DashboardIdentity value={{roleName: roleLabel, employeeName: employee?.full_name || user?.full_name}}><CashierWorkspace /></DashboardIdentity>;
}

function ChequeDesk() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user, canDisburse, canReceiveHandover, isAdmin, canSignChequeGM, canSignChequePM } = useCurrentUser();
  const { toast } = useToast();
  const [approvedPOs, setApprovedPOs] = useState([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState([]);
  const [pendingCheques, setPendingCheques] = useState([]);
  const [payments, setPayments] = useState([]);
  const [disbursementRequests, setDisbursementRequests] = useState([]);
  const [readyToRelease, setReadyToRelease] = useState([]);
  const [loading, setLoading] = useState(true);
  const [disbursePO, setDisbursePO] = useState(null);
  const [payForm, setPayForm] = useState({
    payment_method: "cash", treasury_account_id: "", reference: "", amount: 0,
    payment_date: new Date().toISOString().split("T")[0], notes: ""
  });
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [pos, pays, cheques, treasury, requested, approved] = await Promise.all([
        erp.entities.PurchaseOrder.filter({ status: "approved" }, "-created_date", 50),
        erp.entities.Payment.filter({ payment_type: "supplier_payment" }, "-created_date", 20),
        erp.entities.Payment.filter({ payment_type: "supplier_payment", status: "draft" }, "-created_date", 50),
        canDisburse ? erp.entities.TreasuryAccount.filter({ is_active: true }) : Promise.resolve([]),
        erp.entities.Payment.filter({ payment_type: "supplier_payment", status: "pending_approval" }, "-created_date", 50),
        erp.entities.Payment.filter({ payment_type: "supplier_payment", status: "approved" }, "-created_date", 50),
      ]);
      setTreasuryAccounts(treasury);
      setDisbursementRequests(requested);
      setReadyToRelease(approved);
      // A purchase order already waiting for cash approval is not offered again.
      const spokenFor = new Set([...requested, ...approved].map(p => p.po_id).filter(Boolean));
      setApprovedPOs(pos.filter(p => (p.payment_terms || "cash") === "cash" && !p.cash_disbursed && !spokenFor.has(p.id)));
      setPendingCheques(cheques.filter(c => c.payment_method === "cheque"));
      setPayments(pays.filter(p => p.status !== "draft"));
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  const stats = useMemo(() => ({
    pending: approvedPOs.length,
    totalDue: approvedPOs.reduce((s, p) => s + (p.total || 0), 0),
    paidToday: payments.filter(p => p.payment_date === new Date().toISOString().split("T")[0]).length,
    paidAmount: payments.reduce((s, p) => s + (p.amount || 0), 0),
  }), [approvedPOs, payments]);

  function openDisburse(po) {
    setDisbursePO(po);
    setPayForm({
      payment_method: "cash", treasury_account_id: treasuryAccounts[0]?.id || "", reference: "", amount: po.total || 0,
      payment_date: new Date().toISOString().split("T")[0], notes: ""
    });
  }

  async function handleDisburse() {
    if (!payForm.amount || Number(payForm.amount) <= 0) {
      toast({ title: ui("Error"), description: ui("Enter a valid amount"), variant: "destructive" });
      return;
    }
    const isCheque = payForm.payment_method === "cheque";
    if (!isCheque && !payForm.treasury_account_id) {
      toast({ title: ui("Error"), description: ui("Select the cash/bank account to pay from"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (!isCheque) {
        const account = treasuryAccounts.find(a => a.id === payForm.treasury_account_id);
        await prepareCashDisbursement({
          po: disbursePO, treasuryAccount: account, amount: Number(payForm.amount),
          date: payForm.payment_date, reference: payForm.reference, notes: payForm.notes,
          userId: user?.id || "",
        });
        toast({ title: ui("Sent for approval"), description: ui("{0} for {1} is waiting for the General Manager's approval", formatXAF(payForm.amount), disbursePO.po_number) });
        setDisbursePO(null);
        await loadData();
        setSaving(false);
        return;
      }
      const settings = (await erp.entities.CompanySettings.filter({}))[0];
      const num = settings?.next_journal_number || 1;
      await erp.entities.Payment.create({
        payment_number: `PAY-${String(num).padStart(5, "0")}`,
        payment_type: "supplier_payment",
        party_type: "supplier",
        party_id: disbursePO.supplier_id,
        party_name: disbursePO.supplier_name || "",
        payment_date: payForm.payment_date,
        amount: Number(payForm.amount),
        payment_method: payForm.payment_method,
        reference: payForm.reference || "",
        status: isCheque ? "draft" : "confirmed",
        po_id: disbursePO.id,
        disbursed_by: user?.id || "",
        disbursed_at: new Date().toISOString(),
        notes: payForm.notes || ui("Payment for {0}", disbursePO.po_number),
      });
      if (settings) await erp.entities.CompanySettings.update(settings.id, { next_journal_number: num + 1 });
      if (isCheque) {
        await erp.entities.AuditLog.create({
          action: "prepare_cheque", module: "cashier", entity_type: "PurchaseOrder", entity_id: disbursePO.id,
          user_id: user?.id || "", description: ui("Cheque prepared for {0} — awaiting GM & Operations / Production Manager signatures", disbursePO.po_number),
        });
        toast({ title: ui("Cheque prepared"), description: ui("Cheque for {0} awaiting GM & Operations / Production Manager signatures", disbursePO.supplier_name) });
      }
      setDisbursePO(null);
      loadData();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function handleSignCheque(payment, signType) {
    try {
      const now = new Date().toISOString();
      const signer = user?.full_name || user?.email || "";
      const updates = signType === "gm"
        ? { cheque_gm_signed_by: signer, cheque_gm_signed_at: now }
        : { cheque_pm_signed_by: signer, cheque_pm_signed_at: now };
      const gmSigned = signType === "gm" || !!payment.cheque_gm_signed_by;
      const pmSigned = signType === "pm" || !!payment.cheque_pm_signed_by;
      if (gmSigned && pmSigned) updates.status = "confirmed";
      await erp.entities.Payment.update(payment.id, updates);
      await erp.entities.AuditLog.create({
        action: "sign_cheque", module: "cashier", entity_type: "Payment", entity_id: payment.id,
        user_id: user?.id || "",
        description: ui("{0} signed cheque {1}", signType === "gm" ? "General Manager" : "Operations / Production Manager", payment.payment_number),
      });
      toast({ title: ui("Signed"), description: gmSigned && pmSigned ? ui("Both signatures complete — payment confirmed") : ui("Signature recorded — awaiting counter-signature") });
      loadData();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title={ui("Cashier Dashboard")} subtitle={ui("Approved purchase orders awaiting disbursement")} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard title={ui("Pending Disbursement")} value={stats.pending} icon={Clock} color="text-slate-600" />
        <KPICard title={ui("Total Due")} value={formatXAF(stats.totalDue)} icon={DollarSign} color="text-red-600" />
        <KPICard title={ui("Payments Today")} value={stats.paidToday} icon={CheckCircle2} color="text-green-600" />
        <KPICard title={ui("Total Paid")} value={formatXAF(stats.paidAmount)} icon={Banknote} color="text-blue-600" />
      </div>

      {canReceiveHandover && <><CashCollections
        treasuryAccounts={treasuryAccounts}
        canReceive={canDisburse}
        userId={user?.id || ""}
        userName={user?.full_name || user?.email || ""}
        onDone={loadData}
      />

      <DailyCashReceived canReceive={canReceiveHandover} onDone={loadData} /></>}

      {canDisburse && <PettyCashPanel
        accounts={treasuryAccounts}
        canManage={canDisburse}
        userId={user?.id || ""}
        userName={user?.full_name || user?.email || ""}
        user={user}
        onDone={loadData}
      />}

      <h3 className="text-sm font-semibold text-slate-700 mb-3">{ui("Awaiting Disbursement")}</h3>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("PO #")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Supplier")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Department")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Date")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Action")}</th>
            </tr>
          </thead>
          <tbody>
            {approvedPOs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{ui("No approved purchase orders awaiting disbursement")}</td></tr>
            ) : approvedPOs.map(po => (
              <tr key={po.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{po.po_number}</td>
                <td className="px-4 py-3">{po.supplier_name}</td>
                <td className="px-4 py-3">{po.requested_department_name || "—"}</td>
                <td className="px-4 py-3">{formatDate(po.order_date)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(po.total)}</td>
                <td className="px-4 py-3 text-right">
                  {canDisburse ? (
                    <Button size="sm" onClick={() => openDisburse(po)}><Banknote size={14} className="mr-1" />{ui(" Request cash")}</Button>
                  ) : <span className="text-xs text-slate-400">{ui("View only")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DisbursementRequests
        requests={disbursementRequests}
        ready={readyToRelease}
        treasuryAccounts={treasuryAccounts}
        isApprover={isAdmin}
        canDisburse={canDisburse}
        userId={user?.id || ""}
        onDone={loadData}
      />

      {pendingCheques.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">{ui("Pending Cheque Signatures (GM + Operations / Production Manager)")}</h3>
          <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100/60 border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Cheque #")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Supplier")}</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("GM Signature")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Prod. Manager")}</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {pendingCheques.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium">{p.payment_number}</td>
                    <td className="px-4 py-3">{p.party_name}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatXAF(p.amount)}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.cheque_gm_signed_by
                        ? <span className="text-green-700">✓ {p.cheque_gm_signed_by}</span>
                        : <span className="text-slate-400">{ui("Awaiting")}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.cheque_pm_signed_by
                        ? <span className="text-green-700">✓ {p.cheque_pm_signed_by}</span>
                        : <span className="text-slate-400">{ui("Awaiting")}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {!p.cheque_gm_signed_by && canSignChequeGM && <Button size="sm" onClick={() => handleSignCheque(p, "gm")}>{ui("Sign (GM)")}</Button>}
                        {!p.cheque_pm_signed_by && canSignChequePM && <Button size="sm" onClick={() => handleSignCheque(p, "pm")}>{ui("Sign (PM)")}</Button>}
                        {!p.cheque_gm_signed_by && !p.cheque_pm_signed_by && !canSignChequeGM && !canSignChequePM && <span className="text-xs text-slate-400">{ui("View only")}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 className="text-sm font-semibold text-slate-700 mb-3">{ui("Recent Payments")}</h3>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Payment #")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Supplier")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Date")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Method")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">{ui("No recent payments")}</td></tr>
            ) : payments.map(p => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium">{p.payment_number || "—"}</td>
                <td className="px-4 py-3">{p.party_name}</td>
                <td className="px-4 py-3">{formatDate(p.payment_date)}</td>
                <td className="px-4 py-3 capitalize">{(p.payment_method || ui("cash")).replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(p.amount)}</td>
                <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!disbursePO} onOpenChange={open => !open && setDisbursePO(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ui("Disburse Payment")}</DialogTitle></DialogHeader>
          {disbursePO && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1"><span className="text-slate-500">{ui("PO #:")}</span><span className="font-medium">{disbursePO.po_number}</span></div>
                <div className="flex justify-between mb-1"><span className="text-slate-500">{ui("Supplier:")}</span><span className="font-medium">{disbursePO.supplier_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{ui("Total:")}</span><span className="font-bold">{formatXAF(disbursePO.total)}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{ui("Amount (XAF) *")}</Label>
                  <Input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>{ui("Payment Date")}</Label>
                  <Input type="date" value={payForm.payment_date} onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))} />
                </div>
                <div>
                  <Label>{ui("Payment Method")}</Label>
                  <Select value={payForm.payment_method} onValueChange={v => setPayForm(f => ({ ...f, payment_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{ui("Cash")}</SelectItem>
                      {isAdmin && <SelectItem value="bank_transfer">{ui("Bank Transfer")}</SelectItem>}
                      <SelectItem value="mobile_money">{ui("Mobile Money")}</SelectItem>
                      <SelectItem value="cheque">{ui("Cheque")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payForm.payment_method !== "cheque" && (
                  <div>
                    <Label>{ui("Pay From Account *")}</Label>
                    <Select value={payForm.treasury_account_id} onValueChange={v => setPayForm(f => ({ ...f, treasury_account_id: v }))}>
                      <SelectTrigger><SelectValue placeholder={ui("Select cash / bank account")} /></SelectTrigger>
                      <SelectContent>
                        {treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>{ui("Reference")}</Label>
                  <Input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} placeholder={ui("Optional")} />
                </div>
              </div>
              <div>
                <Label>{ui("Notes")}</Label>
                <Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder={ui("Optional")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisbursePO(null)}>{ui("Cancel")}</Button>
            <Button onClick={handleDisburse} disabled={saving || !payForm.amount}>
              <Banknote size={16} className="mr-1" /> {saving ? ui("Processing...") : payForm.payment_method === "cheque" ? ui("Prepare cheque") : ui("Send for approval")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
