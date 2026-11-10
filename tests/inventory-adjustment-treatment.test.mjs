import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryAdjustmentTreatment,validStockCorrectionAccount} from '../src/lib/inventory-adjustment-treatment.js';
import {warehouseAdjustmentDocument} from '../src/lib/report-models.js';

test('legacy requests remain operating while new purpose and opening confirmation are explicit',()=>{
 assert.equal(inventoryAdjustmentTreatment().purpose,'operating');
 for(const purpose of ['',null,false,'income'])assert.throws(()=>inventoryAdjustmentTreatment({purpose}),/purpose/);
 assert.throws(()=>inventoryAdjustmentTreatment({purpose:'opening_correction',correctionAccountId:'equity'}),/confirm/);
 assert.throws(()=>inventoryAdjustmentTreatment({purpose:'operating',correctionAccountId:'equity'}),/operating count/);
 assert.deepEqual(inventoryAdjustmentTreatment({purpose:'opening_correction',correctionAccountId:' equity ',correctionConfirmed:true}),{purpose:'opening_correction',correction_account_id:'equity',correction_confirmed:true});
});
test('opening counterpart cannot be a P&L, inactive, foreign, nonposting or treasury-linked account',()=>{
 const eq={id:'e',account_number:'1100',account_type:'equity',normal_balance:'credit'};
 assert.equal(validStockCorrectionAccount(eq),true);
 for(const patch of [{account_type:'other_income'},{account_type:'asset'},{is_active:false},{is_posting:false},{currency:'USD'},{normal_balance:'debit'},{is_treasury:true},{account_number:'1050'}])assert.equal(validStockCorrectionAccount({...eq,...patch}),false);
 assert.equal(validStockCorrectionAccount(eq,new Set(['e'])),false);
});
test('posted opening-correction receipts identify equity rather than calling it income or expense',()=>{
 const report=warehouseAdjustmentDocument({id:'wa',purpose:'opening_correction',correction_account:{name:'Opening equity'},reference:'SETUP-1',date:'2026-11-10',value_difference:20,rows:[],posting_lines:[{account_number:'1310',account_name:'Stock',debit:20,credit:0},{account_number:'1100',account_name:'Opening equity',debit:0,credit:20}]});
 assert.deepEqual(report.metadata.find(([label])=>label==='Opening stock equity counterpart'),['Opening stock equity counterpart','Opening equity']);
 assert.equal(report.metadata.some(([label])=>['Expense account','Inventory surplus account'].includes(label)),false);
 assert.equal(report.sections.at(-1).title,'Accounting entry');
});
