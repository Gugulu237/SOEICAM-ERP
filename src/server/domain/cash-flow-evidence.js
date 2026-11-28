import { readRecords } from './commercial-workspace.js';
import { cashFlowRole } from '../../lib/cash-flow-mapping.js';
import { OPENING_COST_MARKER, OPENING_COST_POLICY } from './opening-cost-basis.js';

const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()];
const byId = rows => new Map(rows.map(row => [row.id, row]));
const group = (rows, field) => {
  const result = new Map();
  for (const r of rows) {
    if (!r[field]) continue;
    if (!result.has(r[field])) result.set(r[field], []);
    result.get(r[field]).push(r);
  }
  return result;
};
// A single settlement may have many lines. Bound both the filter and each read.
export async function cashRowsByIds(entity, field, values, filters = {}) {
  const keys = [...new Set(values.filter(Boolean))], rows = [];
  for (let i = 0; i < keys.length; i += 100) {
    rows.push(...await readRecords(entity, { ...filters, [field]: { $in: keys.slice(i, i + 100) } }));
  }
  return rows;
}

const cents = v => Math.round(Number(v || 0) * 100);
const inventoryTypes = new Set(['raw_material','additive','packaging','consumable','spare_part','finished_product','finished_good','wip','assembly','cleaning','promotional']);
const fixedTypes = new Set(['tangible','intangible','financial_asset']);
const labels = {
  movement: ['Treasury movement', 'Mouvement de trésorerie'],
  payment: ['Posted payment', 'Règlement comptabilisé'],
  expense: ['Paid expense', 'Dépense réglée'],
};
function reconcileSources({ groups, kind, journalMap, accountMap, poolLinks, cashByJournal, warnings }) {
  // The three registers are independent controls on the same cash legs. Never
  // sum across registers or treat a register amount as a reportable GL flow.
  for (const docs of groups.values()) {
    const { journalId, accountId, date } = docs[0], journal = journalMap.get(journalId);
    const ref = docs.map(d => d.reference || d.id).join(', ');
    const amount = docs.reduce((n,d) => n + d.signed, 0);
    const matchingLines = (cashByJournal.get(journalId)||[]).filter(l => l.account_id===accountId && (!l.status || ['posted','reversed'].includes(l.status)));
    const ledger = matchingLines.reduce((n,l) => n + cents(l.debit) - cents(l.credit), 0);
    const id = journal?.journal_number || ref;
    const reason = !journal ? ['has no posted ledger entry','ne correspond à aucune écriture comptabilisée'] :
      !accountId || !matchingLines.length ? ['has no matching treasury ledger line','ne correspond à aucune ligne de trésorerie'] :
      ledger !== amount ? ['differs from its posted treasury ledger line','diffère de sa ligne de trésorerie comptabilisée'] :
      docs.some(d => d.date && d.date !== journal.entry_date) ? ['has a different date from its ledger entry','est daté différemment de son écriture comptable'] : null;
    if (!reason) continue;
    const diff = (amount - ledger)/100, account = accountMap.get(accountId);
    const trace = { journalId: journal?.id || '', journalNumber: journal?.journal_number || '', date, source: kind,
      description: docs.map(d=>d.description).filter(Boolean).join('; '), party: docs[0].party || '', reference: ref,
      accountId:accountId || '',accountName:account?.name || '',treasuryAccounts:[poolLinks.get(docs[0].treasuryId)?.name || account?.name].filter(Boolean),amount:amount/100 };
    const dates=journal && date!==journal.entry_date?' ('+date+' / '+journal.entry_date+')':'';
    warnings.push({date,relatedDate:journal?.entry_date,key:kind+'-'+docs[0].id, amount:diff || amount/100, message:labels[kind][0]+' '+ref+' '+reason[0]+dates+'. Check '+id+'.',
      messageFr:labels[kind][1]+' '+ref+' '+reason[1]+dates+'. Vérifier '+id+'.',traces:[trace]});
  }
}

export async function cashFlowEvidence({ s, accounts, postingRules, journals, inPeriod, cashLines, periodLines, treasury, inDates }) {
  const headers=byId(journals), accountMap=byId(accounts), links=byId(treasury);
  const withOriginals=unique([...inPeriod,...inPeriod.map(j=>headers.get(j.reversal_of)).filter(Boolean)]);
  const ids=withOriginals.map(j=>j.id), periodIds=new Set(inPeriod.map(j=>j.id));
  const sourceIds = types => withOriginals.filter(j => types.includes(j.source_document_type)).map(j => j.source_document_id);
  const [txByJournal, txByDate, payByJournal, payByDate, expByJournal, expByDate, invoiceRows, invoiceByJournal, assets, openingAudits] = await Promise.all([
    cashRowsByIds(s.TreasuryTransaction,'journal_id',ids), readRecords(s.TreasuryTransaction,inDates('transaction_date')),
    cashRowsByIds(s.Payment,'journal_id',ids,{status:'posted'}), readRecords(s.Payment,{status:'posted',...inDates('payment_date')}),
    cashRowsByIds(s.ExpenseRequest,'journal_id',ids,{status:'paid'}), readRecords(s.ExpenseRequest,{status:'paid',...inDates('paid_date')}),
    cashRowsByIds(s.Invoice,'id',sourceIds(['Invoice','InvoicePaymentTypeCorrection','PostedSaleEditReversal','CashSaleCustomerCorrection'])),
    cashRowsByIds(s.Invoice,'journal_id',ids),
    cashRowsByIds(s.FixedAsset,'id',sourceIds(['FixedAsset','AssetDisposal'])),
    cashRowsByIds(s.AuditLog,'id',sourceIds(['OpeningLotCostCorrection']),{action:'correct_opening_lot_cost'}),
  ]);
  const txs=unique([...txByJournal,...txByDate]), pays=unique([...payByJournal,...payByDate]), exps=unique([...expByJournal,...expByDate]);
  const invoices=unique([...invoiceRows,...invoiceByJournal]), invoiceMap=byId(invoices), assetMap=byId(assets), auditMap=byId(openingAudits);
  const [bills,allocations,supersedingInvoices] = await Promise.all([
    cashRowsByIds(s.Bill,'id',pays.map(p=>p.bill_id)), cashRowsByIds(s.PaymentAllocation,'payment_id',pays.map(p=>p.id)),
    cashRowsByIds(s.JournalEntry,'id',withOriginals.filter(j=>j.status==='reversed' && j.source_document_type==='Invoice')
      .map(j=>invoiceMap.get(j.source_document_id)?.journal_id).filter(id=>id&&!headers.has(id)),{status:{$in:['posted','reversed']}}),
  ]);
  const invoiceHeaders=new Map([...headers,...byId(supersedingInvoices)]);
  const checkedVersions=new Set();
  let versions=withOriginals.filter(j=>j.status==='reversed' && j.source_document_type==='Invoice')
    .map(j=>invoiceMap.get(j.source_document_id)?.journal_id).filter(Boolean);
  while(versions.length) {
    versions=[...new Set(versions)].filter(id=>!checkedVersions.has(id));
    if(!versions.length) break;
    const missing=versions.filter(id=>!invoiceHeaders.has(id));
    for(const h of await cashRowsByIds(s.JournalEntry,'id',missing,{status:{$in:['posted','reversed']}})) invoiceHeaders.set(h.id,h);
    versions.forEach(id=>checkedVersions.add(id));
    versions=versions.map(id=>invoiceHeaders.get(id)?.previous_journal_id).filter(Boolean);
  }
  const furtherBills=await cashRowsByIds(s.Bill,'id',allocations.filter(a=>a.document_type==='bill'&&!bills.some(b=>b.id===a.document_id)).map(a=>a.document_id));
  const billMap=byId([...bills,...furtherBills]);
  const recordedBills=[...billMap.values()], poIds=[...pays.map(p=>p.po_id), ...recordedBills.map(b=>b.po_id)];
  const billJournals=recordedBills.map(b=>b.journal_id).filter(Boolean);
  const [orders,orderLines,customers,suppliers,olderBillEntries,olderBillLines]=await Promise.all([
    cashRowsByIds(s.PurchaseOrder,'id',poIds),cashRowsByIds(s.PurchaseOrderLine,'po_id',poIds),
    cashRowsByIds(s.Customer,'id',periodLines.filter(l=>l.party_type==='customer').map(l=>l.party_id)),
    cashRowsByIds(s.Supplier,'id',periodLines.filter(l=>l.party_type==='supplier').map(l=>l.party_id)),
    cashRowsByIds(s.JournalEntry,'id',billJournals.filter(id=>!headers.has(id)),{status:'posted'}),
    cashRowsByIds(s.JournalLine,'journal_id',billJournals.filter(id=>!periodIds.has(id))),
  ]);
  const products=byId(await cashRowsByIds(s.Product,'id',orderLines.map(l=>l.product_id)));
  const linesByPo=group(orderLines,'po_id'),poMap=byId(orders),allocsByPay=group(allocations,'payment_id');
  const partyNames = new Map([...customers.map(c=>['customer:'+c.id,c.business_name || c.name]), ...suppliers.map(v=>['supplier:'+v.id,v.name])]);
  const txByJ=group(txs,'journal_id'),payByJ=group(pays,'journal_id'),expByJ=group(exps,'journal_id'),invByJ=group(invoices,'journal_id');
  const lines=group(periodLines,'journal_id'),cash=group(cashLines,'journal_id');
  const evidence=Object.create(null),sourceWarnings=[];
  const role=id=>cashFlowRole(accountMap.get(id),postingRules,accounts);
  function orderPurpose(poId) {
    if (!poMap.has(poId)) return 'unknown';
    const purposes=(linesByPo.get(poId)||[]).map(l=>{
      const product=products.get(l.product_id), recorded=role(l.asset_account_id || l.inventory_account_id || product?.inventory_account_id);
      if(fixedTypes.has(recorded)||recorded==='inventory') return recorded;
      const type=l.inventory_type || product?.inventory_type;
      return product?.item_type!=='service' && inventoryTypes.has(type) ? 'inventory' : 'unknown';
    });
    return !purposes.length || purposes.every(x=>x==='unknown') ? 'unknown' : new Set(purposes).size===1 ? purposes[0] : 'mixed';
  }
  const originalEntries=new Map([...headers,...byId(olderBillEntries)]), originalLines=new Map([...lines,...group(olderBillLines,'journal_id')]);
  function billPurpose(b) {
    const entry=originalEntries.get(b?.journal_id);
    if(entry?.status==='posted' && entry.source_module!=='opening_balances') {
      // Prefer the costed acquisition on the original posted bill to mutable item classifications.
      const debits=(originalLines.get(entry.id)||[]).filter(l=>Number(l.debit)>0 && (!l.status || l.status==='posted'));
      const roles=new Set(debits.map(l=>role(l.account_id)).filter(r=>r!=='vat_receivable'));
      if(roles.size===1 && [...roles].every(r=>fixedTypes.has(r) || r==='inventory')) return [...roles][0];
      if([...roles].some(r=>fixedTypes.has(r))) return 'mixed';
    }
    return orderPurpose(b?.po_id);
  }
  for(const j of withOriginals) {
    const txsJ=txByJ.get(j.id)||[],payments=payByJ.get(j.id)||[],expenses=expByJ.get(j.id)||[];
    const tx=txsJ.length===1?txsJ[0]:null,pay=payments.length===1?payments[0]:null,expense=expenses.length===1?expenses[0]:null;
    const invoice=(j.source_document_type==='Invoice'&&invoiceMap.get(j.source_document_id)) || invByJ.get(j.id)?.[0];
    const asset=assetMap.get(j.source_document_id),allocs=pay?allocsByPay.get(pay.id)||[]:[];
    const billIds=[...new Set([pay?.bill_id,...allocs.filter(a=>a.document_type==='bill').map(a=>a.document_id)].filter(Boolean))];
    const payBills=billIds.map(id=>billMap.get(id)), bill=payBills.length===1?payBills[0]:null;
    const purposes=payBills.map(billPurpose);
    if(pay?.po_id && !payBills.some(b=>b?.po_id===pay.po_id)) purposes.push(orderPurpose(pay.po_id));
    const refs=[invoice?.invoice_number,pay?.payment_number, ...allocs.map(a=>a.document_number),bill?.bill_number,
      pay?.po_id&&poMap.get(pay.po_id)?.po_number,expense?.request_number,asset?.asset_number,tx?.source_document_number,tx?.reference || tx?.transaction_number].filter(Boolean);
    const parties=[...new Set([pay?.party_name,invoice?.customer_name,tx?.customer_name,tx?.payee,expense?.payee,...(lines.get(j.id)||[]).map(l=>partyNames.get(l.party_type+':'+l.party_id))].filter(Boolean))];
    evidence[j.id]={ party:parties.join('; '), reference:[...new Set(refs)].join(' / ') || j.reference || '',
      category:pay?.payment_type || tx?.source || '',documentType:pay?'Payment':invoice?'Invoice':expense?'ExpenseRequest':asset?'FixedAsset':j.source_document_type,
      expenseAccountId:expense?.expense_account_id || tx?.expense_account_id || (bill?.accounting_source==='recurring_expense'?bill.recurring_account_id:'') || '',
      ...(asset && fixedTypes.has(role(asset.asset_account_id)) ? {assetRole:role(asset.asset_account_id)} : {}),
      ...(pay?.payment_type==='supplier_payment'?{paymentPurpose:purposes.length?(new Set(purposes).size===1?purposes[0]:'mixed'):'unknown'}:{}),
    };
    for(const k of Object.keys(evidence[j.id])) if(!evidence[j.id][k]) delete evidence[j.id][k];
    if (j.source_module==='accounting_corrections' && j.source_document_type==='OpeningLotCostCorrection' && j.is_immutable===true) {
      const audit=auditMap.get(j.source_document_id), proof=audit?.[OPENING_COST_MARKER];
      if(audit?.audit_source==='server_verified' && audit.action==='correct_opening_lot_cost' && audit.module==='accounting_corrections' &&
        audit.entity_type==='JournalEntry' && audit.entity_id===j.id && audit.user_id && audit.user_id===j.posted_by &&
        audit.accounting_control_opening_cost_policy===OPENING_COST_POLICY && proof?.policy===OPENING_COST_POLICY &&
        proof.id===j.source_document_id && proof.journal_id===j.id && proof.date===j.entry_date &&
        proof.stock_disposition==='fully_sold' && proof.requires_corrected_basis_reversal===true) {
        evidence[j.id].openingCostCorrection=Object.fromEntries(['opening_account_id','cogs_account_id','cost_reduction','journal_id','id','policy'].map(k=>[k,proof[k]]));
      }
    }
    if (!(cash.get(j.id)||[]).length || j.reversal_of) continue;
    const documentRows = j.source_document_type==='Payment'?payments:j.source_document_type==='TreasuryTransaction'?txsJ:
      j.source_document_type==='Invoice'?invByJ.get(j.id)||[]:null;
    // Older headers may omit their document ID, but must still have one
    // unambiguous source pointing back. An explicit conflicting ID is never ignored.
    let revisedInvoice=false;
    if(j.source_document_type==='Invoice' && !documentRows.length && j.status==='reversed' &&
      headers.get(j.reversed_by_journal)?.reversal_of===j.id && invoice?.id===j.source_document_id) {
      const visited=new Set();
      let replacement=invoiceHeaders.get(invoice.journal_id);
      while(replacement?.source_document_type==='Invoice' && replacement.source_document_id===invoice.id && !visited.has(replacement.id)) {
        visited.add(replacement.id);
        if(replacement.previous_journal_id===j.id) {revisedInvoice=true;break;}
        replacement=invoiceHeaders.get(replacement.previous_journal_id);
      }
    }
    const wrongSource=!!documentRows && !revisedInvoice && (documentRows.length!==1 || !!j.source_document_id && documentRows[0].id!==j.source_document_id);
    if(wrongSource) {
      const ref=j.journal_number || j.id;
      sourceWarnings.push({date:j.entry_date,key:'source-link-'+j.id,amount:0,
        message:'Verify the '+j.source_document_type+' linked to journal '+ref+'. The source document is missing or linked to another posting.',
        messageFr:'Vérifier le document '+j.source_document_type+' de l’écriture '+ref+' : il est absent ou rattaché à une autre écriture.',
        traces:[{journalId:j.id,journalNumber:ref,date:j.entry_date,reference:j.source_document_id,source:j.source_document_type,
          party:evidence[j.id].party,description:j.description || '',treasuryAccounts:[...new Set((cash.get(j.id)||[]).map(l=>accountMap.get(l.account_id)?.name).filter(Boolean))],
          amount:(cash.get(j.id)||[]).reduce((n,l)=>n+cents(l.debit)-cents(l.credit),0)/100}]});
    }
  }
  const controls = {movement:new Map(),payment:new Map(),expense:new Map()};
  function add(kind,row,journalId,treasuryId,glId,date,signed,reference,party,description) {
    const accountId=links.get(treasuryId)?.gl_account_id || glId || '';
    const key=JSON.stringify([journalId||row.id,accountId]);
    if (!controls[kind].has(key)) controls[kind].set(key,[]);
    controls[kind].get(key).push({id:row.id,journalId,treasuryId,accountId,date:date || headers.get(journalId)?.entry_date,signed,reference,party,description});
  }
  for(const t of txs) add('movement',t,t.journal_id,t.treasury_account_id,'',t.transaction_date,
    (['receipt','transfer_in'].includes(t.transaction_type)?1:-1)*cents(t.amount),t.transaction_number || t.reference,t.payee || t.customer_name,t.description);
  for(const p of pays) if(['customer_payment','supplier_payment'].includes(p.payment_type)) add('payment',p,p.journal_id,p.treasury_account_id,p.account_id,
    p.payment_date,(p.payment_type==='supplier_payment'?-1:1)*cents(p.amount),p.payment_number,p.party_name,p.reference);
  for(const e of exps) add('expense',e,e.journal_id,e.treasury_account_id,'',e.paid_date || e.paid_at?.slice(0,10),-cents(e.amount),e.request_number,e.payee,e.title);
  for(const [kind,groups] of Object.entries(controls)) reconcileSources({groups,kind,journalMap:headers,accountMap,poolLinks:links,cashByJournal:cash,warnings:sourceWarnings});
  return {evidence,sourceWarnings};
}
