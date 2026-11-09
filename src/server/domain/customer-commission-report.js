import {businessDate} from '../../lib/business-date.js';
import {canViewAllCommercialReports} from '../../lib/operations-access.js';
import {isOpeningRecord} from '../../lib/opening-records.js';
import {requireStaff} from './field-ops.js';
import {readRecords} from './commercial-workspace.js';
import {principalRole,ROLE_KEYS} from './roles.js';
import {journalCents,journalDate,checkedJournalLines,journalPayload,ledgerStatuses} from './journal-validation.js';

export const CUSTOMER_COMMISSION_ACTIONS=['customerCommissions'];
const invoiceStatuses=['posted','partially_paid','paid','overdue','credited'];
const denied=()=>Object.assign(Error('You may view only your own customer commissions.'),{status:403});
const inPeriod=(date,from,to)=>date>=from&&date<=to;
const text=value=>typeof value==='string'&&Boolean(value.trim());
const owner=row=>row.acquired_by_id||row.registered_employee_id||'';
const sum=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('Commission totals exceed the supported precision.');return n;};
const money=value=>{if(value==null)throw Error('A sale amount is missing.');return journalCents(value);};
const date=value=>{journalDate(value);return value;};
const fieldSource=row=>row.field_sale_id||row.source_field_sale_id||row.origin_field_sale_id||row.fieldSaleId||row.sourceFieldSaleId||'';

export function commissionMonth(month=businessDate().slice(0,7),asOf=businessDate()){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw Error('Choose a valid commission month.');
 const from=date(month+'-01');date(asOf);
 if(from>asOf)throw Error('Choose the current month or an earlier commission month.');
 const next=new Date(from+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
 return {month,from,to:[next.toISOString().slice(0,10),asOf].sort()[0],as_of:asOf};
}

function checkedRevenue(journal,lines,accounts){
 if(!journal||!ledgerStatuses.includes(journal.status)||!journal.id||!lines.length||lines.some(l=>l.journal_id!==journal.id||l.status&&!ledgerStatuses.includes(l.status))||new Set(lines.map(l=>l.id)).size!==lines.length)throw Error('Unverified sale journal.');
 date(journal.entry_date);
 const checked=checkedJournalLines(lines);
 if(money(journal.total_debit)!==money(checked.debit)||money(journal.total_credit)!==money(checked.credit))throw Error('Unverified sale journal totals.');
 if(journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw Error('Unverified sale journal payload.');
 let revenue=0;
 for(const line of checked.lines){const account=accounts.get(line.account_id);if(!account)throw Error('The sale journal references a missing account.');if(account.account_type==='revenue')revenue=sum(revenue,money(line.credit)-money(line.debit));}
 return revenue;
}

// Sales belong to their customer acquisition owner, independently of the seller.
// Linked invoices and FieldSales represent one source, never two commissions.
export function verifiedCommissionSales({invoices=[],fieldSales=[],journals=[],journalLines=[],accounts=[],from,to}){
 const headers=new Map(journals.map(j=>[j.id,j])),accountMap=new Map(accounts.map(a=>[a.id,a])),lines=new Map(),sourceHeaders=new Map();
 for(const line of journalLines){const rows=lines.get(line.journal_id)||[];rows.push(line);lines.set(line.journal_id,rows);}
 for(const header of journals.filter(j=>ledgerStatuses.includes(j.status))){const key=header.source_document_type+':'+header.source_document_id;sourceHeaders.set(key,(sourceHeaders.get(key)||0)+1);}
 const fields=fieldSales.filter(row=>row.status==='approved_posted'&&row.supply_kind!=='exchange');
 const fieldJournals=new Set(fields.map(row=>row.journal_id).filter(Boolean));
 const linked=invoices.filter(row=>fieldSource(row)||fieldJournals.has(row.journal_id));
 let unverified=linked.filter(row=>!fields.some(f=>f.id===fieldSource(row)&&f.journal_id===row.journal_id||f.journal_id===row.journal_id)).length;
 const candidates=[...fields.map(row=>({row,type:'FieldSale',kind:'Commercial supply',dateKey:'transaction_date',sellerKey:'commercial_id',nameKey:'commercial_name'})),...invoices.filter(row=>!linked.includes(row)&&invoiceStatuses.includes(row.status)&&!isOpeningRecord(row)&&!row.opening_receivable_id&&!row.is_opening_balance).map(row=>({row,type:'Invoice',kind:'Invoice',dateKey:'invoice_date',sellerKey:'salesperson_id',nameKey:'salesperson_name'}))];
 const journalUses=new Map();for(const item of candidates)journalUses.set(item.row.journal_id,(journalUses.get(item.row.journal_id)||0)+1);
 const sales=[];
 for(const {row,type,kind,dateKey,sellerKey,nameKey} of candidates){
  try{
   const originalDate=date(row[dateKey]),total=money(row.total),net=money(row.subtotal),tax=money(row.tax_total??0),header=headers.get(row.journal_id);
   if(!text(row.id)||!text(row.customer_id)||!total||sum(net,tax)!==total||journalUses.get(row.journal_id)!==1||sourceHeaders.get(type+':'+row.id)!==1||!header||header.source_document_type!==type||header.source_document_id!==row.id||header.source_module!==(type==='Invoice'?'sales':'field_sales')||header.entry_date!==originalDate||header.reversal_of||checkedRevenue(header,lines.get(header.id)||[],accountMap)!==net)throw Error('Unverified sale source.');
   const reversal=row.sale_reversal;
   if(reversal){
    const correction=headers.get(reversal.journal_id),reversalDate=date(reversal.date);
    if(!text(reversal.journal_id)||header.reversed_by_journal!==reversal.journal_id||reversalDate<originalDate||row.sale_reversal_date!==reversalDate||money(reversal.total)!==total||sum(money(reversal.customer_credit),money(reversal.unpaid_cancelled))!==total||!correction||correction.status!=='posted'||correction.source_module!=='sales'||correction.source_document_type!=='SaleReversal'||correction.source_document_id!==header.id||correction.reversal_of!==header.id||correction.reversed_by_journal||correction.entry_date!==reversalDate||checkedRevenue(correction,lines.get(correction.id)||[],accountMap)!==-net||type==='Invoice'&&row.status!=='credited')throw Error('Unverified sale reversal.');
   }else if(header.status!=='posted'||header.reversed_by_journal||row.sale_reversal_date||type==='Invoice'&&row.status==='credited')throw Error('Missing sale reversal evidence.');
   const frozenOwner=Object.hasOwn(row,'sales_supply_acquisition_agent_id');
   if(frozenOwner&&typeof row.sales_supply_acquisition_agent_id!=='string')throw Error('Invalid customer acquisition snapshot.');
   const base={document_id:row.id,document_number:row.invoice_number||row.sale_number||row.id,source:type,source_label:kind,customer_id:row.customer_id,customer_name:row.customer_name||'',salesperson_id:row[sellerKey]||'',salesperson_name:row[nameKey]||'',...(frozenOwner?{acquisition_agent_id:row.sales_supply_acquisition_agent_id}:{}),registration_user_id:row.sales_supply_registration_user_id||''};
   if(inPeriod(originalDate,from,to))sales.push({...base,id:type+':'+row.id,date:originalDate,net:net/100,total:total/100,is_reversal:false});
   if(reversal&&inPeriod(reversal.date,from,to))sales.push({...base,id:'reversal:'+type+':'+row.id,date:reversal.date,net:-net/100,total:-total/100,is_reversal:true});
  }catch{unverified++;}
 }
 return {sales:sales.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),unverified_sales:unverified};
}

function registeredDate(customer){
 const value=customer.acquisition_date||customer.registered_at;
 if(typeof value!=='string'||!value)return '';
 try{return value.length===10?date(value):businessDate(new Date(value));}catch{return '';}
}
function rateValue(value,max){
 if(value==null||value==='')return {value:null};
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)return {value:null,error:true};
 return {value};
}
// Multiply integer cents by the exact decimal form of the configured rate.
function percentage(cents,rate){
 const raw=String(rate),[coefficient,exponentText='0']=raw.toLowerCase().split('e'),exponent=Number(exponentText),[whole,fraction='']=coefficient.split('.');
 let numerator=BigInt(whole+fraction),denominator=100n,power=fraction.length-exponent;
 if(power>=0)denominator*=10n**BigInt(power);else numerator*=10n**BigInt(-power);
 const sign=cents<0?-1n:1n,value=BigInt(Math.abs(cents))*numerator;
 return Number(sign*((value+denominator/2n)/denominator));
}

export function customerCommissionModel({employees=[],customers=[],sales=[],month,from,to,as_of}){
 const employeeMap=new Map(employees.map(e=>[e.id,e])),sourceCustomers=new Map(customers.map(c=>[c.id,c])),customerMap=new Map(),summary=new Map();
 const customerView=(customer,agentId,historical=false)=>{const agent=employeeMap.get(agentId),registered=registeredDate(customer),registeredThisMonth=!historical&&Boolean(registered&&inPeriod(registered,from,to));return {id:customer.id,report_key:customer.id+':'+agentId,business_name:customer.business_name||'',parent_id:customer.parent_id||'',agent_id:agentId,agent_name:agent.full_name||customer.acquired_by_name||'',registered_date:registered,registered_this_month:registeredThisMonth,verified:customer.acquisition_verified==='verified_unique',eligible_for_commission:!['duplicate','rejected'].includes(customer.acquisition_verified),historical_only:historical,net_sales:0,total_sales:0,sales_count:0};};
 for(const customer of customers){const agentId=owner(customer);if(!agentId||!employeeMap.has(agentId))continue;
  const view=customerView(customer,agentId);customerMap.set(view.report_key,view);
 }
 for(const employee of employees){const rate=rateValue(employee.commission_rate_percent,100),bonus=rateValue(employee.new_customer_bonus,1e9),invalid=rate.error||bonus.error;let bonusCents=0;
  try{if(bonus.value!==null)bonusCents=journalCents(bonus.value);}catch{bonus.error=true;}
  summary.set(employee.id,{id:employee.id,full_name:employee.full_name||'',registered_customers:0,total_customers:0,verified_new_customers:0,net_sales:0,total_sales:0,eligible_net_sales:0,sales_count:0,commission_rate_percent:rate.value,new_customer_bonus:bonus.value,configured:!invalid&&!bonus.error&&(rate.value!==null||bonus.value!==null),configuration_error:invalid||bonus.error?'Review the employee commission rate and customer bonus before calculating commissions.':'',_bonus_cents:bonusCents});
 }
 for(const customer of customerMap.values()){const row=summary.get(customer.agent_id);row.total_customers++;if(customer.registered_this_month)row.registered_customers++;if(customer.registered_this_month&&customer.verified&&customer.eligible_for_commission)row.verified_new_customers++;}
 const attributed=[];
 for(const sale of sales){const sourceCustomer=sourceCustomers.get(sale.customer_id);if(!sourceCustomer)continue;const agentId=Object.hasOwn(sale,'acquisition_agent_id')?sale.acquisition_agent_id:owner(sourceCustomer);if(!agentId||!employeeMap.has(agentId))continue;const key=sourceCustomer.id+':'+agentId;let customer=customerMap.get(key);if(!customer){customer=customerView(sourceCustomer,agentId,true);customerMap.set(key,customer);}const row=summary.get(agentId),net=Math.round(sale.net*100),total=Math.round(sale.total*100);if(!Number.isSafeInteger(net)||!Number.isSafeInteger(total))throw Error('Commission totals exceed the supported precision.');
  for(const target of [row,customer]){target.net_sales=sum(Math.round(target.net_sales*100),net)/100;target.total_sales=sum(Math.round(target.total_sales*100),total)/100;if(!sale.is_reversal)target.sales_count++;}
  if(customer.eligible_for_commission)row.eligible_net_sales=sum(Math.round(row.eligible_net_sales*100),net)/100;
  attributed.push({...sale,agent_id:customer.agent_id,agent_name:customer.agent_name});
 }
 for(const row of summary.values()){
  row.commission_estimate=row.configured&&row.commission_rate_percent!==null?percentage(Math.round(row.eligible_net_sales*100),row.commission_rate_percent)/100:null;
  row.customer_bonus_estimate=row.configured&&row.new_customer_bonus!==null?sum(0,row._bonus_cents*row.verified_new_customers)/100:null;
  row.estimated_total=row.configured?sum(Math.round((row.commission_estimate||0)*100),Math.round((row.customer_bonus_estimate||0)*100))/100:null;delete row._bonus_cents;
 }
 return {month,from,to,as_of,basis:'net_sales',is_estimate:true,agents:[...summary.values()].sort((a,b)=>a.full_name.localeCompare(b.full_name)),customers:[...customerMap.values()].sort((a,b)=>a.business_name.localeCompare(b.business_name)),sales:attributed,unassigned_customers:customers.filter(c=>!owner(c)||!employeeMap.has(owner(c))).length};
}

async function byIds(store,key,ids,filters={}){const rows=[],unique=[...new Set(ids.filter(Boolean))];for(let i=0;i<unique.length;i+=100)rows.push(...await readRecords(store,{...filters,[key]:{$in:unique.slice(i,i+100)}}));return rows;}

async function reportModuleAccess(client,role,canViewAll,ownReport){
 const globalModule=canViewAll&&role==='warehouse_manager'?'sales_reports':'commercial',checked=new Map();
 const permitted=async module=>{if(checked.has(module))return checked.get(module);try{await client.auth.assertModule?.(module);checked.set(module,true);return true;}catch(error){if(error.status!==403)throw error;checked.set(module,false);return false;}};
 if(!ownReport||role==='admin'||role==='commercial'){if(!await permitted(globalModule))throw denied();return canViewAll;}
 // An operational employee may inspect only their own customer portfolio.
 // This grants neither sales entry nor access to another employee's report.
 let ownAllowed=false;for(const module of ['commercial','sales','inventory','purchases','cashier'])if(await permitted(module)){ownAllowed=true;break;}
 if(!ownAllowed)throw denied();
 return canViewAll&&await permitted(globalModule);
}

export async function customerCommissionAction(client,user,body={}){
 const {employee}=await requireStaff(client,user,ROLE_KEYS,'customer commission reports'),role=principalRole(user,employee),canViewAll=canViewAllCommercialReports(role,employee);
 if(!user?.id||role!=='admin'&&(!employee||employee.status!=='active'||employee.user_id&&employee.user_id!==user.id))throw denied();
 if(body.action!=='customerCommissions'||Object.keys(body).some(key=>!['action','month','commercialId'].includes(key)))throw Error('Choose a valid customer commission report.');
 const requested=body.commercialId??'';if(typeof requested!=='string'||requested.length>200)throw denied();
 if(!canViewAll&&requested&&requested!==employee.id)throw denied();
 const canViewAllReport=await reportModuleAccess(client,role,canViewAll,!canViewAll||Boolean(employee?.id&&requested===employee.id));
 const period=commissionMonth(body.month),selected=canViewAll?requested:employee.id,s=client.asServiceRole.entities;
 const employees=selected?await byIds(s.Employee,'id',[selected]):await readRecords(s.Employee),customers=selected?await readRecords(s.Customer,{$or:[{acquired_by_id:selected},{registered_employee_id:selected}]}):await readRecords(s.Customer);
 if(selected&&!employees.some(e=>e.id===selected))throw Error('Choose an existing employee for the commission report.');
 // An explicitly attributed acquirer takes precedence over a registrar snapshot.
 const owned=customers.filter(customer=>!selected||owner(customer)===selected),customerIds=owned.map(c=>c.id),dateFilter=key=>({$or:[{[key]:{$gte:period.from,$lte:period.to}},{sale_reversal_date:{$gte:period.from,$lte:period.to}}]});
 const invoiceFilter={status:{$in:invoiceStatuses},...dateFilter('invoice_date')},fieldFilter={status:'approved_posted',...dateFilter('transaction_date')};
 const [customerInvoices,customerFields,frozenInvoices,frozenFields]=await Promise.all([byIds(s.Invoice,'customer_id',customerIds,invoiceFilter),byIds(s.FieldSale,'customer_id',customerIds,fieldFilter),selected?readRecords(s.Invoice,{...invoiceFilter,sales_supply_acquisition_agent_id:selected}):[],selected?readRecords(s.FieldSale,{...fieldFilter,sales_supply_acquisition_agent_id:selected}):[]]);
 const belongs=row=>!selected||!Object.hasOwn(row,'sales_supply_acquisition_agent_id')||row.sales_supply_acquisition_agent_id===selected;
 const invoices=[...new Map([...customerInvoices,...frozenInvoices].filter(belongs).map(row=>[row.id,row])).values()],fields=[...new Map([...customerFields,...frozenFields].filter(belongs).map(row=>[row.id,row])).values()];
 const extraCustomers=await byIds(s.Customer,'id',[...invoices,...fields].map(row=>row.customer_id).filter(id=>!owned.some(c=>c.id===id))),reportCustomers=[...new Map([...owned,...extraCustomers].map(row=>[row.id,row])).values()];
 const journalIds=[...invoices,...fields].flatMap(row=>[row.journal_id,row.sale_reversal?.journal_id]),[byReference,invoiceHeaders,fieldHeaders,accounts]=await Promise.all([byIds(s.JournalEntry,'id',journalIds),byIds(s.JournalEntry,'source_document_id',invoices.filter(i=>!fieldSource(i)).map(i=>i.id),{source_document_type:'Invoice'}),byIds(s.JournalEntry,'source_document_id',fields.map(f=>f.id),{source_document_type:'FieldSale'}),readRecords(s.Account)]);
 const journals=[...new Map([...byReference,...invoiceHeaders,...fieldHeaders].map(row=>[row.id,row])).values()],journalLines=await byIds(s.JournalLine,'journal_id',journals.map(j=>j.id)),verified=verifiedCommissionSales({invoices,fieldSales:fields,journals,journalLines,accounts,...period});
 const result=customerCommissionModel({employees,customers:reportCustomers,sales:verified.sales,...period});
 const canAssign=role==='admin',[assignmentCustomers,assignmentEmployees]=await Promise.all([canAssign&&selected?readRecords(s.Customer):reportCustomers,canAssign&&selected?readRecords(s.Employee):employees]);
 const unassigned=canAssign?assignmentCustomers.filter(customer=>!owner(customer)&&customer.is_active!==false&&!customer.customer_removed_at):[];
 return {...result,scope:canViewAllReport?'all':'own',can_view_all:canViewAllReport,can_assign_customers:canAssign,selected_agent_id:selected,unassigned_customers:canAssign?unassigned.length:canViewAllReport?result.unassigned_customers:0,unassigned_customer_details:unassigned.map(c=>({id:c.id,business_name:c.business_name||'',registered_date:registeredDate(c),registered_by_id:c.registered_by_id||''})),assignment_agents:canAssign?assignmentEmployees.filter(e=>e.status==='active'&&!e.employee_removed_at).map(e=>({id:e.id,full_name:e.full_name||''})).sort((a,b)=>a.full_name.localeCompare(b.full_name)):[],unverified_sales:verified.unverified_sales};
}
