
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { payExpense } from "@/lib/expenses";

// Cashier disburses an approved expense from a treasury account.
export default function PayExpenseDialog({ request, onOpenChange, onPaid, user, defaultTreasuryId = "" }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [treasuryAccounts, setTreasuryAccounts] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [treasuryId, setTreasuryId] = useState(defaultTreasuryId);
  const [expenseId, setExpenseId] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!request) return;
    Promise.all([
      erp.entities.TreasuryAccount.filter({ is_active: true }),
      erp.entities.Account.filter({ account_type: "expense", is_active: true }),
    ]).then(([t, a]) => {
      setTreasuryAccounts(t);
      setExpenseAccounts(a);
      setExpenseId(request.expense_account_id || "");
    });
  }, [request?.id]);

  async function handlePay() {
    const treasuryAccount = treasuryAccounts.find(a => a.id === treasuryId);
    const expenseAccount = expenseAccounts.find(a => a.id === expenseId);
    if (!treasuryAccount || !expenseAccount) {
      toast({ title: ui("Select both the paying account and the expense account"), variant: "destructive" });
      return;
    }
    setPaying(true);
    try {
      await payExpense({
        request, treasuryAccount, expenseAccount,
        userId: user?.id || "", userName: user?.full_name || "",
      });
      toast({ title: ui("Expense paid"), description: ui("Treasury, ledger and budget updated") });
      onOpenChange(false);
      onPaid();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setPaying(false);
  }

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{ui("Pay ")}{request?.request_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="font-medium text-slate-900">{request?.title}</p>
            <p className="text-xl font-bold text-slate-900 mt-1">{formatXAF(request?.amount)}</p>
            <p className="text-xs text-slate-500">{request?.department_name || ui("No department")}{ui(" · requested by ")}{request?.requester_name || "—"}</p>
          </div>
          <div>
            <Label>{ui("Pay From *")}</Label>
            <Select value={treasuryId} onValueChange={setTreasuryId}>
              <SelectTrigger><SelectValue placeholder={ui("Select treasury account")} /></SelectTrigger>
              <SelectContent>{treasuryAccounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name} — {formatXAF(a.balance)}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Expense Account *")}</Label>
            <Select value={expenseId} onValueChange={setExpenseId}>
              <SelectTrigger><SelectValue placeholder={ui("Select expense account")} /></SelectTrigger>
              <SelectContent>{expenseAccounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button onClick={handlePay} disabled={paying}>{paying ? ui("Paying…") : ui("Confirm Payment")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}