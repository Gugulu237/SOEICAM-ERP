import {businessDate} from '../../lib/business-date.js';
import {requireStaff} from './field-ops.js';
import {principalRole} from './roles.js';
import {readRecords} from './commercial-workspace.js';
import {periodDates} from './commercial-rules.js';
const roles=['admin','procurement','warehouse_manager','cashier','production_manager','employee','commercial','driver','hotesse'];
const types={
 Payment:{label:'Payment',roles:['cashier'],ref:'payment_number',amount:'amount',actions:['approve_customer_receipt','approve_cash_disbursement']},
 CashHandover:{label:'Cash handover',roles:['cashier'],ref:'handover_number',amount:'received_amount',actions:['confirm_handover']},
 PurchaseOrder:{label:'Purchase order',roles:['procurement'],ref:'po_number',amount:'total',actions:['approve','approve_po']},
 ProductionOrder:{label:'Production order',roles:['production_manager','warehouse_manager'],ref:'order_number',actions:['approve_production']},
 DispatchRequest:{label:'Stock request',roles:['warehouse_manager','production_manager'],ref:'request_number',actions:['approve_dispatch_request']},
 Dispatch:{label:'Goods issue',roles:['warehouse_manager','production_manager'],ref:'dispatch_number',actions:['approve_dispatch']},
 ExpenseRequest:{label:'Expense request',roles:['production_manager','cashier'],ref:'request_number',amount:'amount',actions:['approve_expense']},
 Recipe:{label:'Recipe',roles:['production_manager'],ref:'recipe_name',actions:['approve_yogurt_recipe','approve_recipe']},
 PayrollRun:{label:'Payroll',roles:['cashier'],ref:'period_name',amount:'total_net',actions:['approve_payroll','payroll_approve']},
 FieldSale:{label:'Field sale',roles:[],ref:'sale_number',amount:'total',actions:['approve_field_sale']},
};
const ownerFields=['requester_id','commercial_id','salesperson_id','employee_id','prepared_by','created_by','recorded_by','collector_user_id','collector_employee_id','cashier_confirmed_by','approved_by_user_id','approved_by'];
export async function approvalHistory(client,user,body){
 const {employee}=await requireStaff(client,user,roles,'approval history');
 const role=principalRole(user,employee);
 if(role!=='admin'&&(!employee||employee.status!=='active'||employee.employee_removed_at))throw Error('An active staff account is required.');
 const {from,to}=periodDates(body.from,body.to),s=client.asServiceRole.entities;
 const actions=[...new Set(Object.values(types).flatMap(t=>t.actions))];
 const start=new Date(from+'T00:00:00+01:00').toISOString(),end=new Date(to+'T23:59:59.999+01:00').toISOString();
 const [events,staff]=await Promise.all([readRecords(s.AuditLog,{action:{$in:actions},created_date:{$gte:start,$lte:end}}),readRecords(s.Employee)]);
 const names=new Map(staff.flatMap(e=>[[e.id,e.full_name],[e.user_id,e.full_name]]).filter(([id])=>id));names.set(user.id,user.full_name||employee?.full_name||user.email);
 const identities=[employee?.id,user.id,user.email].filter(Boolean),rows=[];
 for(const [entity,type] of Object.entries(types)){
   const documents=await readRecords(s[entity]);
   for(const doc of documents){
     const related=events.filter(e=>e.entity_type===entity&&e.entity_id===doc.id&&type.actions.includes(e.action)&&e.audit_source==='server_verified');
     if(role!=='admin'&&!type.roles.includes(role)&&!ownerFields.some(f=>identities.includes(doc[f]))&&!related.some(e=>e.user_id===user.id))continue;
     const label=entity==='Payment'?(doc.payment_type==='customer_payment'?'Customer receipt':doc.payment_type==='supplier_payment'?'Supplier payment':'Payment'):type.label;
     const make=(id,time,actor,description,evidence,decision)=>({id,entity,entity_id:doc.id,type:label,reference:doc[type.ref]||doc.id,party:doc.party_name||doc.customer_name||doc.supplier_name||doc.commercial_name||doc.requester_name||'',amount:type.amount&&doc[type.amount]!=null?Number(doc[type.amount]):null,approved_at:time||'',approved_by:names.get(actor)||actor||'',description:description||'',evidence,decision,current_status:doc.status||'',journal_id:doc.journal_id||'',journal_number:doc.journal_number||''});
     related.forEach(e=>rows.push({...make(e.id,e.created_date,e.user_id,e.description,'Audit event',e.action==='confirm_handover'?'Cash received':'Approved'),approved_by:e.user_name||names.get(e.user_id)||e.user_id||'',approver_id:e.user_id||''}));
     // Historical metadata remains useful when no server audit event was retained.
     // Never infer approval from a paid/posted status or fabricate an actor/date.
     const time=doc.approved_at;
     if(time&&Number.isFinite(Date.parse(time))&&businessDate(new Date(time))>=from&&businessDate(new Date(time))<=to&&!related.some(e=>e.action!=='confirm_handover'))rows.push(make(entity+':'+doc.id,time,doc.approved_by_user_id||doc.approved_by_name||doc.approved_by,'','Approval metadata','Approved'));
   }
 }
 return {rows:rows.sort((a,b)=>b.approved_at.localeCompare(a.approved_at)||a.id.localeCompare(b.id)),scope:role==='admin'?'Company approval history':'Approvals visible to your role and your own records',from,to};
}
