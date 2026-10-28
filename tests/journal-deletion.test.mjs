import test from 'node:test';
import assert from 'node:assert/strict';
import {journalLifecycle} from '../src/server/domain/journal-lifecycle.js';
const context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
function fixture(overrides={}){
 const journal={id:'j1',journal_number:'JV00001',entry_date:'2026-10-01',status:'draft',source_module:'manual',source_document_type:'manual_journal',...overrides};
 const rows={JournalEntry:[journal],JournalLine:[{id:'l1',journal_id:'j1',status:'draft',debit:100,credit:0}],AccountingPeriod:[],AuditLog:[]};
 const stores=Object.fromEntries(Object.entries(rows).map(([name,data])=>[name,{
 get:async id=>data.find(r=>r.id===id),filter:async q=>data.filter(r=>Object.entries(q).every(([k,v])=>r[k]===v)),
 create:async r=>{data.push(r);return r;},deleteMany:async q=>{for(let i=data.length-1;i>=0;i--)if(Object.entries(q).every(([k,v])=>data[i][k]===v))data.splice(i,1);}
 }]));return {stores,rows};
}
const request={action:'deleteDraft',journalId:'j1',reason:'Entered twice by mistake'};
test('GM deletes manual draft and its lines while retaining complete audit evidence',async()=>{
 const {stores,rows}=fixture();assert.equal((await journalLifecycle(stores,context,request)).deleted,true);
 assert.equal(rows.JournalEntry.length,0);assert.equal(rows.JournalLine.length,0);
 assert.equal(rows.AuditLog[0].deleted_journal.journal_number,'JV00001');assert.equal(rows.AuditLog[0].deleted_lines.length,1);
});
for(const [label,override] of [['posted',{status:'posted'}],['immutable',{is_immutable:true}],['linked',{source_module:'sales',source_document_id:'sale1'}],['reversed',{reversal_of:'j2'}]])test('deletion rejects '+label+' journals',async()=>{
 const {stores,rows}=fixture(override);await assert.rejects(journalLifecycle(stores,context,request));assert.equal(rows.JournalEntry.length,1);assert.equal(rows.AuditLog.length,0);
});
test('cashier cannot delete a draft',async()=>{const {stores}=fixture();await assert.rejects(journalLifecycle(stores,{user:{id:'c',role:'cashier'},role:'cashier',employee:null},request));});
test('deletion requires reason and respects period locks and posted lines',async()=>{
 for(const mode of ['reason','period','line']){const {stores,rows}=fixture();if(mode==='period')rows.AccountingPeriod.push({start_date:'2026-01-01',end_date:'2026-12-31',status:'closed'});if(mode==='line')rows.JournalLine[0].status='posted';await assert.rejects(journalLifecycle(stores,context,{...request,...(mode==='reason'?{reason:''}:{})}));assert.equal(rows.JournalEntry.length,1);}
});
