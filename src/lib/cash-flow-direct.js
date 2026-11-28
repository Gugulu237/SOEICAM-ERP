import { assertCashFlowRange as cashFlowDates } from './cash-flow-period.js';
import { cashFlowPool, cashFlowRole } from './cash-flow-mapping.js';
export { cashFlowPool } from './cash-flow-mapping.js';

// All accumulation is in integer hundredths of XAF, including journal totals
// originating in weighted inventory costs. Round only on conversion from GL.
function cents(value) {
  if(value==null)return 0;
  if(!['string','number'].includes(typeof value)||value==='')throw Error('Invalid cash-flow ledger amount.');
  const n=Number(value),c=Math.round(n*100);
  if(!Number.isSafeInteger(c)||Math.abs(n*100-c)>0.001)throw Error('Invalid cash-flow ledger amount or precision.');
  return c;
}
function money(c){if(!Number.isSafeInteger(c))throw Error('Cash-flow totals exceed supported precision.');return c/100;}
const validStatus=s=>s==='posted'||s==='reversed';
const compare=(a,b)=>a.date.localeCompare(b.date)||a.journalNumber.localeCompare(b.journalNumber);
const categories = {
  cash_sales:['operating','Cash sales received','Ventes au comptant encaissées'],
  customer_collections:['operating','Customer collections','Recouvrements auprès des clients'],
  refunds:['operating','Cash refunded to customers','Remboursements aux clients'],
  other_receipts:['operating','Other operating receipts','Autres encaissements opérationnels'],
  suppliers:['operating','Inventory and supplier payments','Achats de stocks et règlements fournisseurs'],
  salary:['operating','Salaries and payroll','Salaires et charges de personnel'],
  rent:['operating','Rent and occupancy','Loyers et charges locatives'],
  marketing:['operating','Marketing and promotions','Marketing et promotions'],
  distribution:['operating','Distribution and logistics','Distribution et logistique'],
  utilities:['operating','Utilities and communications','Eau, énergie et communications'],
  taxes:['operating','Taxes and statutory payments','Impôts, taxes et versements obligatoires'],
  interest:['operating','Finance charges and interest','Frais financiers et intérêts'],
  other_payments:['operating','Other operating payments','Autres décaissements opérationnels'],
  intangible:['investing','Intangible asset acquisitions','Acquisitions d’immobilisations incorporelles','FF'],
  tangible:['investing','Equipment and other fixed asset acquisitions','Acquisitions d’immobilisations corporelles','FG'],
  financial_asset:['investing','Financial asset acquisitions','Acquisitions d’immobilisations financières','FH'],
  disposal:['investing','Disposals of tangible and intangible assets','Cessions d’immobilisations corporelles et incorporelles','FI'],
  financial_disposal:['investing','Disposals of financial assets','Cessions d’immobilisations financières','FJ'],
  capital:['equity','Capital contributions received','Apports en capital encaissés','FK'],
  grant:['equity','Investment grants received','Subventions d’investissement reçues','FL'],
  withdrawal:['equity','Capital withdrawals','Prélèvements sur le capital','FM'],
  dividends:['equity','Dividends paid','Dividendes versés','FN'],
  loan:['debt','Loan proceeds','Emprunts encaissés','FO'],
  other_debt:['debt','Other financial borrowings','Autres dettes financières encaissées','FP'],
  principal:['debt','Repayment of financial debt principal','Remboursements du principal des dettes financières','FQ'],
};
function mappedKey(role, sign) {
  switch(role){
    case 'sales': return sign>0?'cash_sales':'refunds';
    case 'receivable':case 'customer_deposit':return sign>0?'customer_collections':'refunds';
    case 'supplier_payable':case 'inventory':case 'supplier_advance':case 'cogs':return 'suppliers';
    case 'employee_advance':case 'salary_payable':case 'salary':return 'salary';
    case 'vat_receivable':case 'tax_payable':case 'taxes':return 'taxes';
    case 'interest_payable':case 'accrued_interest_receivable':case 'interest':return 'interest';
    case 'rent':case 'marketing':case 'distribution':case 'utilities':return role;
    case 'other_operating':case 'accrued':case 'prepaid':return sign>0?'other_receipts':'other_payments';
    case 'tangible':case 'intangible':case 'financial_asset':
      return sign<0?role:(role==='financial_asset'?'financial_disposal':'disposal');
    case 'loan':case 'other_debt':return sign>0?role:'principal';
    case 'capital':case 'subscribed_capital_receivable':return sign>0?'capital':'withdrawal';
    case 'grant_receivable':case 'grant':return 'grant';
    case 'dividends':return 'dividends';
    case 'asset_disposal_receivable':return 'disposal';
    case 'financial_disposal_receivable':return 'financial_disposal';
    default:return null;
  }
}
function amounts(lines){
  return lines.reduce((sum,l)=>{
    const d=cents(l.debit),c=cents(l.credit);
    if(d<0||c<0||d&&c||l.status&&!validStatus(l.status))throw Error('Invalid or unposted line in posted journal '+l.journal_id);
    sum.d+=d;sum.c+=c;return sum;
  },{d:0,c:0});
}
const accountName=a=>[a?.account_number,a?.name].filter(Boolean).join(' · ');
const eachUniqueLine=lines=>{
  const seen=new Set();
  return (lines||[]).filter(l=>{if(!l.id)return true;if(seen.has(l.id))return false;seen.add(l.id);return true;});
};
function groupByJournal(lines){
  const map=new Map();
  for(const line of eachUniqueLine(lines)){
    if(!map.has(line.journal_id))map.set(line.journal_id,[]);
    map.get(line.journal_id).push(line);
  }
  return map;
}
export function buildDirectCashFlow({accounts,treasury=[],postingRules=[],journals,cashLines,periodLines,from,to,evidence={}}){
  cashFlowDates(from,to);
  const pool=cashFlowPool(accounts,treasury,postingRules),poolIds=new Set(pool.map(a=>a.id)),byAccount=new Map(accounts.map(a=>[a.id,a]));
  const byId=new Map(journals.filter(j=>validStatus(j.status)).map(j=>[j.id,j])),roles=new Map(accounts.map(a=>[a.id,cashFlowRole(a,postingRules,accounts)]));
  const reverseLinks=new Set([...byId.values()].map(j=>j.reversal_of).filter(Boolean));
  const period=groupByJournal(periodLines),cash=groupByJournal((cashLines||[]).filter(l=>poolIds.has(l.account_id)));
  const balances=new Map(pool.map(a=>[a.id,{accountId:a.id,number:a.account_number,name:a.name,opening:0,closing:0,all:0,openingTraces:[],closingTraces:[]}]));
  const issues=[],transferTraces=[],openingTraces=[],closingTraces=[],correctionTraces=[];
  const rows=new Map();
  const issue=(key,message,messageFr,amount,traces=[])=>issues.push({key,message,messageFr,amount:money(amount),traces});
  function sourceInfo(j){
    const original=j.reversal_of?byId.get(j.reversal_of):null;
    const e={...(original?evidence[original.id]:{}),...evidence[j.id]};
    return {source:original||j,e};
  }
  function trace(j,lines,cashGroup,amount,account){
    const {e}=sourceInfo(j);
    return {journalId:j.id,date:j.entry_date,journalNumber:String(j.journal_number||j.id),reference:e.reference||j.reference||j.source_document_id||j.journal_number||j.id,
      description:j.description||'',source:j.source_module||'manual',documentType:j.source_document_type||'',
      party:e.party||[...new Set(lines.map(l=>l.party_name||l.party_id).filter(Boolean))].join(', '),
      treasuryAccounts:[...new Set(cashGroup.map(l=>accountName(byAccount.get(l.account_id))))],amount:money(amount),
      accountId:account?.id||'',accountNumber:account?.account_number||'',accountName:account?.name||''};
  }
  function add(key,t){
    const [section,label,labelFr,code]=categories[key];
    const row=rows.get(key)||{key,label,labelFr,code:code||'',section,inflow:0,outflow:0,traces:[]};
    const n=cents(t.amount); row[n>0?'inflow':'outflow']+=n;row.traces.push(t);rows.set(key,row);
  }
  if(!pool.length)issue('no_treasury','No treasury GL accounts are mapped. Check Treasury and Chart of Accounts.','Aucun compte de trésorerie paramétré. Vérifiez la trésorerie et le plan comptable.',0);
  for(const [id,ls] of cash){
    const j=byId.get(id);if(!j)continue;
    cashFlowDates(j.entry_date,j.entry_date);
    for(const l of ls){
      const {d,c}=amounts([l]),b=balances.get(l.account_id),n=d-c;
      b.all+=n;
      if(j.entry_date>to||!n)continue;
      b.closing+=n;
      const t=trace(j,period.get(id)||[l],[l],n,byAccount.get(l.account_id));
      b.closingTraces.push(t);closingTraces.push(t);
      if(j.entry_date<from){b.opening+=n;b.openingTraces.push(t);openingTraces.push(t);}
    }
    if(j.entry_date<=to&&(j.status==='reversed'||j.reversed_by_journal)&&!reverseLinks.has(j.id)&&!byId.has(j.reversed_by_journal)){
      const totals=amounts(ls),n=totals.d-totals.c;
      issue('missing_reversal','The original is marked reversed but no posted reversal can be found. Reconcile the linked journal.',
        'L’écriture est marquée contrepassée, mais sa contrepassation comptabilisée est introuvable. Vérifiez le journal lié.',
        n,[trace(j,period.get(id)||ls,ls,n)]);
    }
  }
  // A corrected payment type or voided posting is not both a receipt and a
  // payment. Suppress an exactly offset original treasury leg and correction
  // in the same report; retain both in GL traces. Across a boundary the
  // dated correction must still change treasury. Genuine refunds remain flows.
  const offset=new Set(),journalCashNet=id=>(cash.get(id)||[]).reduce((n,l)=>n+cents(l.debit)-cents(l.credit),0);
  for(const [id] of cash){
    const j=byId.get(id);
    if(!j||j.entry_date<from||j.entry_date>to)continue;
    const src=j.reversal_of||(j.source_document_type==='InvoicePaymentTypeCorrection'?j.original_journal_id:null);
    const original=byId.get(src);
    if(!original||original.entry_date<from||original.entry_date>to||j.source_document_type==='SaleReversal'||evidence[id]?.category==='refund'||offset.has(src))continue;
    const a=cash.get(src)||[],b=cash.get(id)||[];
    const signature=(ls,factor)=>{const legs=new Map();for(const l of ls)legs.set(l.account_id,(legs.get(l.account_id)||0)+factor*(cents(l.debit)-cents(l.credit)));return JSON.stringify([...legs].filter(([,n])=>n).sort(([a],[b])=>a.localeCompare(b)));};
    if(journalCashNet(id)&&signature(a,1)===signature(b,-1)){offset.add(id);offset.add(src);}
  }
  let internal=0;
  for(const id of new Set([...cash.keys(),...period.keys()])){
    const j=byId.get(id);if(!j||j.entry_date<from||j.entry_date>to)continue;
    const lines=period.get(id)||[],cashGroup=lines.filter(l=>poolIds.has(l.account_id)),expected=cash.get(id)||[];
    if(!cashGroup.length&&!expected.length)continue;
    const all=amounts(lines),{d,c}=amounts(cashGroup),book=amounts(expected);
    const net=d-c,externalTrace=trace(j,lines,cashGroup.length?cashGroup:expected,book.d-book.c);
    if(!lines.length||all.d!==all.c||d!==book.d||c!==book.c){
      issue('incomplete_journal','The posted journal is unbalanced or its cash detail is incomplete. Open the journal and reconcile its lines.',
        'L’écriture comptabilisée est déséquilibrée ou ses lignes de trésorerie sont incomplètes. Vérifiez les lignes du journal.',book.d-book.c,[externalTrace]);continue;
    }
    if(offset.has(id)){correctionTraces.push(externalTrace);continue;}
    const {source,e}=sourceInfo(j),other=lines.filter(l=>!poolIds.has(l.account_id)&&(cents(l.credit)||cents(l.debit)));
    const rev=j.reversal_of||j.source_document_type==='InvoicePaymentTypeCorrection';
    const type=source.source_document_type,mod=source.source_module;
    if(mod==='opening_balances'||type==='OpeningBalances'){
      if(net)issue('opening_import','Opening balances were posted inside this period. Check their effective date; an import is not a cash flow.',
        'Des soldes d’ouverture ont été comptabilisés dans cette période. Vérifiez leur date d’effet ; une reprise n’est pas un flux.',net,[externalTrace]);continue;
    }
    function transfer(n){if(n){internal+=n;transferTraces.push({...externalTrace,amount:money(n)});}}
    if(!other.length){
      // A customer reassignment on a single clearing account is not even an
      // internal transfer. Count only amounts moved between distinct accounts.
      const perAccount=new Map();
      for(const l of cashGroup)perAccount.set(l.account_id,(perAccount.get(l.account_id)||0)+cents(l.debit)-cents(l.credit));
      transfer([...perAccount.values()].reduce((n,v)=>n+Math.max(0,v),0));continue;
    }
    const oneDirection=net!==0&&other.every(l=>Math.sign(cents(l.credit)-cents(l.debit))===Math.sign(net));
    // The actual external amount of a known mixed sale/receipt (part cash,
    // part credit, COGS, inventory and VAT) is the net treasury leg only.
    const sale=(['sales','field_sales'].includes(mod)&&['FieldSale','Invoice','InvoicePaymentTypeCorrection'].includes(type))||e.category==='cash_sale'||e.category==='sale_correction';
    // A Payment header alone is not evidence of a customer receipt. With no
    // settlement document, use the actual AR, AP, debt or other counterpart.
    const collection=['customer_payment','customer_receipt'].includes(e.category);
    const fixedTypes=['tangible','intangible','financial_asset'];
    const assetClasses=new Set(other.map(l=>roles.get(l.account_id)).filter(r=>fixedTypes.includes(r)));
    const manualDisposal=net>0&&!c&&assetClasses.size===1&&other.every(l=>{
      const r=roles.get(l.account_id);
      return fixedTypes.includes(r)?cents(l.credit)>0:
        ['accumulated_depreciation','disposal_loss'].includes(r)?cents(l.debit)>0:
        ['disposal_gain','tax_payable'].includes(r)&&cents(l.credit)>0;
    });
    const asset=(mod==='assets'&&['FixedAsset','AssetDisposal'].includes(type))||manualDisposal;
    let key=null;
    if(sale)key=net>=0?'cash_sales':rev?'cash_sales':'refunds';
    if(collection)key=net>=0?'customer_collections':rev?'customer_collections':'refunds';
    if(asset){
      const assetRole=e.assetRole||(assetClasses.size===1?[...assetClasses][0]:null);
      if(assetRole)key=mappedKey(assetRole,type==='AssetDisposal'||manualDisposal?1:-1);
    }
    // Equipment partly paid and partly financed: only the treasury leg
    // represents investment made in cash. Do not invent financing proceeds
    // or an operating supplier payment for the unpaid part.
    if(!key && net<0 && !d && !oneDirection){
      const bought=other.filter(l=>cents(l.debit)&&['intangible','tangible','financial_asset'].includes(roles.get(l.account_id)));
      const creditors=other.filter(l=>cents(l.credit)&&['supplier_payable','investment_payable','loan','other_debt'].includes(roles.get(l.account_id)));
      const types=new Set(bought.map(l=>roles.get(l.account_id)));
      if(types.size===1&&creditors.length&&bought.length+creditors.length===other.length)key=[...types][0];
    }
    if(key&&net&&(!d||!c||((sale||collection)&&oneDirection))){
      // When recoverable VAT (or VAT payable on a disposal) has a separate
      // booked leg in a wholly cash-settled asset deal, that working-capital
      // item belongs in operating cash. Never manufacture VAT from a rate.
      const taxes=asset?other.filter(l=>['vat_receivable','tax_payable'].includes(roles.get(l.account_id))):[];
      if(taxes.length){
        const taxNet=taxes.reduce((n,l)=>n+cents(l.credit)-cents(l.debit),0);
        const unpaid=other.some(l=>['investment_payable','supplier_payable','disposal_receivable','asset_disposal_receivable','financial_disposal_receivable'].includes(roles.get(l.account_id)));
        if(unpaid||taxes.some(l=>Math.sign(cents(l.credit)-cents(l.debit))!==Math.sign(net))||Math.abs(taxNet)>Math.abs(net)){
          issue('asset_tax_split','Confirm the settled asset cost and tax on this partly paid or mixed asset transaction.',
            'Confirmez le coût de l’actif et la taxe effectivement réglés dans cette opération mixte ou partiellement réglée.',net,[externalTrace]);continue;
        }
        for(const l of taxes)add('taxes',trace(j,lines,cashGroup,cents(l.credit)-cents(l.debit),byAccount.get(l.account_id)));
        if(net!==taxNet)add(key,trace(j,lines,cashGroup,net-taxNet));
        continue;
      }
      transfer(Math.min(d,c));add(key,trace(j,lines,cashGroup,net));continue;
    }
    if(!oneDirection||d&&c&&new Set(cashGroup.map(l=>l.account_id)).size<2){
      issue('compound','A compound journal has no documented allocation between cash and non-cash entries. Review the journal and source document.',
        'Une écriture composée ne ventile pas la trésorerie et les mouvements non monétaires. Vérifiez le journal et le justificatif.',net,
        [d&&trace(j,lines,cashGroup.filter(l=>cents(l.debit)),d),c&&trace(j,lines,cashGroup.filter(l=>cents(l.credit)),-c)].filter(Boolean));continue;
    }
    transfer(Math.min(d,c));
    const manualRetail=other.some(l=>roles.get(l.account_id)==='sales')&&other.every(l=>['sales','tax_payable'].includes(roles.get(l.account_id)));
    if(manualRetail){add(net>0?'cash_sales':'refunds',externalTrace);continue;}
    for(const l of other){
      const value=cents(l.credit)-cents(l.debit),a=byAccount.get(l.account_id),role=roles.get(l.account_id),t=trace(j,lines,cashGroup,value,a);
      let purpose=role;
      if(role==='disposal_receivable'){
        const underlying=e.assetRole||e.paymentPurpose;
        if(['tangible','intangible'].includes(underlying))purpose='asset_disposal_receivable';
        if(underlying==='financial_asset')purpose='financial_disposal_receivable';
      }
      if(['supplier_payable','investment_payable','supplier_advance','accrued'].includes(role)){
        if(e.expenseAccountId)purpose=roles.get(e.expenseAccountId);
        else if(e.paymentPurpose)purpose=e.paymentPurpose;
      }
      const k=mappedKey(purpose,Math.sign(value)*(rev?-1:1));
      if(k){add(k,t);continue;}
      issue('unclassified','Cash counterpart or payment purpose is unmapped. Check the source bill and set its cash-flow role in Chart of Accounts.',
        'La contrepartie ou l’objet du paiement n’est pas identifié. Vérifiez la facture et son affectation dans le plan comptable.',value,[t]);
    }
  }
  let openingCents=0,closingCents=0;
  const components=[...balances.values()].map(b=>{
    const a=byAccount.get(b.accountId),orientation=a.normal_balance==='credit'?-1:1;
    openingCents+=b.opening;closingCents+=b.closing;
    const links=treasury.filter(t=>t.gl_account_id===a.id);
    const t=b.closingTraces;
    if(a.balance!=null){
      const d=cents(a.balance)*orientation-b.all;
      if(d)issue('stored_gl',b.number+': current GL balance differs from all posted ledger entries.',b.number+' : le solde actuel du compte diffère du total des écritures comptabilisées.',d,t);
    }
    if(links.length===1&&links[0].balance!=null){
      const d=cents(links[0].balance)*orientation-b.all;
      if(d)issue('treasury_balance',b.number+': current Treasury module balance differs from its posted ledger.',b.number+' : le solde actuel du module Trésorerie diffère du grand livre.',d,t);
    }
    if(links.length>1)issue('shared_link',b.number+': several treasury accounts share one GL account. Review the links; the ledger is counted once.',
      b.number+' : plusieurs comptes de trésorerie partagent le même compte général. Vérifiez les liens ; le compte n’est compté qu’une fois.',0,t);
    return {accountId:b.accountId,number:b.number,name:b.name,opening:money(b.opening),closing:money(b.closing),openingTraces:b.openingTraces.sort(compare),closingTraces:b.closingTraces.sort(compare)};
  }).sort((a,b)=>String(a.number).localeCompare(String(b.number)));
  const sections=['operating','investing','equity','debt'].map(key=>{
    const detail=Object.keys(categories).map(k=>rows.get(k)).filter(row=>row?.section===key);
    const inflow=detail.reduce((n,r)=>n+r.inflow,0),outflow=detail.reduce((n,r)=>n+r.outflow,0);
    return {key,inflow:money(inflow),outflow:money(outflow),net:money(inflow+outflow),
      rows:detail.map(r=>({...r,inflow:money(r.inflow),outflow:money(r.outflow),net:money(r.inflow+r.outflow),traces:r.traces.sort(compare)}))};
  });
  const [operating,investing,equity,debt]=sections.map(s=>s.net),netCents=sections.reduce((n,s)=>n+cents(s.net),0),calculated=openingCents+netCents;
  return {from,to,opening:money(openingCents),closing:money(closingCents),calculatedClosing:money(calculated),net:money(netCents),operating,investing,equity,debt,financing:money(cents(equity)+cents(debt)),
    difference:money(closingCents-calculated),sections,components,openingTraces:openingTraces.sort(compare),closingTraces:closingTraces.sort(compare),
    internalTransfers:money(internal),transferTraces:transferTraces.sort(compare),correctionTraces:correctionTraces.sort(compare),issues};
}
