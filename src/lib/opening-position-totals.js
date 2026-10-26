// Preview only: the server validates references and computes authoritative totals.
export function openingPositionTotals(details,lines,setup){
 const accounts=new Map(),defaults=setup?.defaults||{};
 const add=(id,debit=0,credit=0)=>{const old=accounts.get(id)||{account_id:id,debit:0,credit:0};old.debit+=Math.round(Number(debit||0)*100);old.credit+=Math.round(Number(credit||0)*100);accounts.set(id,old);};
 for(const row of details){
  if(row.kind==='cash')add(setup?.treasury?.find(t=>t.id===row.treasury_id)?.account_id,row.amount);
  if(row.kind==='stock')add(setup?.products?.find(p=>p.id===row.product_id)?.account_id,Number(row.quantity)*Number(row.unit_cost));
  if(row.kind==='asset'){add(row.asset_account_id,row.acquisition_cost);if(Number(row.accumulated_depreciation)>0)add(row.accum_dep_account_id,0,row.accumulated_depreciation);}
  if(row.kind==='receivable')add(defaults.customer_receivable,row.amount);
  if(row.kind==='payable')add(defaults.supplier_payable,0,row.amount);
 }
 for(const row of lines)if(row.account_id||Number(row.debit)||Number(row.credit))add(row.account_id,row.debit,row.credit);
 const values=[...accounts.values()].map(r=>({...r,debit:r.debit/100,credit:r.credit/100}));
 return {accounts:values,debit:values.reduce((n,l)=>n+l.debit,0),credit:values.reduce((n,l)=>n+l.credit,0)};
}
