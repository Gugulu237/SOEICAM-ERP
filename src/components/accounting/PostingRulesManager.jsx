
/* localized-interface */
import {validPostingRuleAccount} from '@/lib/posting-rule-types';
import {readAll} from '@/lib/field-pos';
import {Button} from '@/components/ui/button';
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function PostingRulesManager() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { isAdmin } = useCurrentUser();
  const { toast } = useToast();
  const [rules, setRules] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true),[error,setError]=useState(""),[revision,setRevision]=useState(0);

  useEffect(() => {
    let active=true;setLoading(true);setError("");Promise.all([
      readAll(erp.entities.PostingRule),
      readAll(erp.entities.Account,{is_active:true},"account_number"),
    ]).then(([r, a]) => {
      if(!active)return;setRules(r.sort((x, y) => (x.rule_key || "").localeCompare(y.rule_key || "")));
      setAccounts(a.sort((x, y) => x.account_number.localeCompare(y.account_number)));
    }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  }, [revision]);

  async function updateRule(rule, accountId) {
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return;
    try{setError("");await erp.entities.PostingRule.update(rule.id, {
      account_id: acc.id, account_number: acc.account_number, account_name: acc.name,
    });
    setRules((prev) => prev.map((r) => r.id === rule.id
      ? { ...r, account_id: acc.id, account_number: acc.account_number, account_name: acc.name } : r));
    toast({ title: ui("Posting rule updated"), description: `${rule.label || rule.rule_key} → ${acc.account_number} ${acc.name}` });}catch(e){setError(e.message);}
  }

  if (loading) return <div className="py-10 text-center text-slate-400">{ui("Loading posting rules…")}</div>;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {error&&<div role="alert" className="p-3 text-sm text-red-700">{uiMessage(error)} <Button type="button" variant="outline" onClick={()=>setRevision(r=>r+1)}>{ui("Retry")}</Button></div>}
      <table className="mobile-table-cards w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-3">{ui("Posting Rule")}</th>
            <th className="px-4 py-3">{ui("Description")}</th>
            <th className="px-4 py-3 w-[35%]">{ui("Mapped Account")}</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-400">{ui("No posting rules configured yet")}</td></tr>
          )}
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-slate-100">
              <td data-label={ui("Posting Rule")} className="px-4 py-3 font-medium">{r.label || r.rule_key}</td>
              <td data-label={ui("Description")} className="px-4 py-3 text-slate-500">{r.description}</td>
              <td data-label={ui("Mapped Account")} className="px-4 py-3">
                {isAdmin ? (
                  <Select value={r.account_id} onValueChange={(v) => updateRule(r, v)}>
                    <SelectTrigger aria-label={ui("Mapped Account") + ": " + (r.label || r.rule_key)}><SelectValue placeholder={ui("Select account")} /></SelectTrigger>
                    <SelectContent>
                      {accounts.filter(a=>validPostingRuleAccount(a,r.rule_key)).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span>{r.account_number} — {r.account_name}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">{ui("Automatic postings from sales, purchases, production and payroll resolve their accounts through these rules — no account is hardcoded. Only the General Manager can change mappings.")}</p>
    </div>
  );
}