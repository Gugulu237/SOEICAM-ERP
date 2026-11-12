import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date,user} from './helpers/cashier.mjs';
import {approvalHistory} from '../src/server/domain/approval-history.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';
const gm={id:'gm',role:'admin',full_name:'Manager'},range={from:date.slice(0,8)+'01',to:date};
test('history retains approved payments after posting or reversal and preserves repeated decisions without inferring paid status',async()=>{
 const f=await fixture(),s=f.entities,approved=date+'T09:00:00.000Z';
 const paid=await s.Payment.create({payment_number:'RCP-1',payment_type:'customer_payment',status:'posted',amount:1200,approved_at:approved,approved_by_user_id:'gm',journal_id:'journal'});
 await s.Payment.create({payment_number:'NO-PROOF',status:'paid',amount:600});await s.Payment.create({payment_number:'PENDING',status:'pending_approval',amount:500});
 const event={action:'approve_customer_receipt',audit_source:'server_verified',entity_type:'Payment',entity_id:paid.id,user_id:'gm',description:'Approved RCP-1',created_date:approved};await s.AuditLog.create(event);await s.AuditLog.create({...event,created_date:date+'T10:00:00.000Z'});
 await s.AuditLog.create({...event,audit_source:'client_reported',description:'forged'});
 const before=structuredClone(f.rows),data=await approvalHistory(f.client,gm,range);assert.equal(data.rows.length,2);assert.ok(data.rows.every(r=>r.reference==='RCP-1'&&r.approved_by==='Manager'&&r.current_status==='posted'&&r.evidence==='Audit event'));assert.deepEqual(f.rows,before);
 await s.Payment.update(paid.id,{status:'reversed'});assert.ok((await approvalHistory(f.client,gm,range)).rows.every(r=>r.current_status==='reversed'));
 assert.equal(isReadOnlyFunction('fieldOps','approvalHistory'),true);
});
test('legacy approval metadata stays visible with missing names explicit and approved records page beyond 200',async()=>{
 const f=await fixture(),s=f.entities;for(let i=0;i<220;i++)await s.Payment.create({payment_number:'OLD-'+i,payment_type:'supplier_payment',status:'paid',amount:i,approved_at:date+'T12:00:00.000Z'});
 const data=await approvalHistory(f.client,gm,range);assert.equal(data.rows.length,220);assert.ok(data.rows.every(r=>r.approved_by===''&&r.evidence==='Approval metadata'));
 await s.Payment.create({payment_number:'OUTSIDE',approved_at:'2000-01-01T00:00:00Z'});assert.equal((await approvalHistory(f.client,gm,range)).rows.length,220);
});
test('ordinary staff see their own approvals while cashiers see payment decisions without payroll or other departments leaking to employees',async()=>{
 const f=await fixture(),s=f.entities,approved=date+'T12:00:00.000Z';
 await s.Payment.create({payment_number:'MINE',prepared_by:user.id,approved_at:approved,amount:10});await s.Payment.create({payment_number:'OTHER',approved_at:approved,amount:20});await s.PayrollRun.create({period_name:'Payroll',approved_at:approved,total_net:900});await s.ExpenseRequest.create({request_number:'OWN-EXPENSE',requester_id:'cashier',approved_at:approved,amount:5});
 await s.PurchaseOrder.create({po_number:'OLD-PO',requester_id:'cashier',approved_at:approved,total:100});
 assert.ok((await approvalHistory(f.client,gm,range)).rows.some(row=>row.reference==='OLD-PO'));
 await s.Employee.update('cashier',{role:'employee'});assert.deepEqual((await approvalHistory(f.client,user,range)).rows.map(r=>r.reference).sort(),['MINE','OWN-EXPENSE']);
 await s.Employee.update('cashier',{role:'cashier'});assert.equal((await approvalHistory(f.client,user,range)).rows.length,4);
 await s.Employee.update('cashier',{status:'inactive'});await assert.rejects(approvalHistory(f.client,user,range),/active staff/);
});
