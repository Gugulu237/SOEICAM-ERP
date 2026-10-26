import test from 'node:test';
import assert from 'node:assert/strict';
import {openingOffset} from '../src/lib/opening-offset.js';
const equity={id:'equity',account_number:'1000',name:'Opening Balance Equity',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true};
const total=(debit,credit=0,accounts=[])=>({debit,credit,accounts});
test('opening asset debits receive an equal credit to the explicitly selected equity account',()=>{
 assert.deepEqual(openingOffset(total(50000),'equity',[equity]),{line:{account_id:'equity',debit:0,credit:50000},error:''});
 assert.deepEqual(openingOffset(total(0,12000),'equity',[equity]).line,{account_id:'equity',debit:12000,credit:0});
 assert.deepEqual(openingOffset(total(100000,35000),'equity',[equity]).line,{account_id:'equity',debit:0,credit:65000});
});
test('counterparts recalculate in cents and are never created or chosen implicitly',()=>{
 assert.equal(openingOffset(total(100),'',[equity]).line,null);
 assert.equal(openingOffset(total(100,100),'equity',[equity]).line,null);
 assert.equal(openingOffset(total(.1+.2,.01),'equity',[equity]).line.credit,.29);
 assert.equal(openingOffset(total(0,.29),'equity',[equity]).line.debit,.29);
});
test('offsets cannot overwrite an entered account, reuse opened balances or choose revenue and expense accounts',()=>{
 assert.ok(openingOffset(total(100,0,[{account_id:'equity'}]),'equity',[equity]).error);
 for(const change of [{account_type:'revenue'},{account_type:'expense'},{is_active:false},{is_posting:false},{normal_balance:'debit'},{opening_recorded:true},{is_control_account:true},{currency:'USD'}])assert.ok(openingOffset(total(100),'equity',[{...equity,...change}]).error);
 for(const t of [total(Infinity),total(NaN),total(-1),total(1e14)])assert.ok(openingOffset(t,'equity',[equity]).error);
});
