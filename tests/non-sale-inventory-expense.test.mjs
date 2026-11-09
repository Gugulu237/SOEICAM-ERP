import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNonSaleInventoryExpense,nonSaleInventoryExpenseAccount} from '../src/server/domain/non-sale-inventory-expense.js';

const definitions=[
 ['customer_replacement_expense','CUSTOMER-REPLACEMENTS','Customer replacements','Actual inventory cost of no-charge customer replacements'],
 ['unreturned_goods_expense','UNRETURNED-GOODS','Unreturned goods from cancelled sales','Cost of cancelled-sale goods that have not been returned to company inventory'],
];
const validAccount=(value={})=>({id:'configured-expense',account_number:'6978',name:'Configured non-sale inventory expense',account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true,currency:'XAF',balance:17,...value});
function fixture(seed={}){
 const rows={Account:[],PostingRule:[],TreasuryAccount:[],...structuredClone(seed)},created=[];let sequence=0;
 const stores=Object.fromEntries(Object.entries(rows).map(([name,data])=>[name,{
  filter:async(query={},sort,limit=200,skip=0)=>structuredClone(data.filter(row=>Object.entries(query).every(([key,value])=>row[key]===value)).slice(skip,skip+limit)),
  get:async id=>structuredClone(data.find(row=>row.id===id)),
  create:async value=>{const row={...structuredClone(value),id:'created-'+(++sequence)};data.push(row);created.push({entity:name,value:structuredClone(row)});return structuredClone(row);},
 }]));
 return{stores,rows,created,snapshot:()=>structuredClone(rows)};
}

test('resolution is read-only and exposes complete configuration proof for each supported dedicated expense',async()=>{
 for(const[key,number,name]of definitions){
  const f=fixture({TreasuryAccount:[{id:'bank',gl_account_id:'bank-gl',is_active:true}]}),before=f.snapshot(),resolved=await resolveNonSaleInventoryExpense(f.stores,key);
  assert.deepEqual(resolved,{rule_key:key,account_number:number,name,account:null,rule:null,needs_account:true,needs_rule:true,proof:{rules:[],accounts:[],treasury:[{id:'bank',gl_account_id:'bank-gl',is_active:true}]}});
  assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.created,[]);
 }
 const f=fixture(),before=f.snapshot();for(const key of ['direct_material_cogs','marketing_degustation_expense','',undefined]){await assert.rejects(resolveNonSaleInventoryExpense(f.stores,key),/supported non-sale inventory expense/);await assert.rejects(nonSaleInventoryExpenseAccount(f.stores,key),/supported non-sale inventory expense/);}assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.created,[]);
});

test('provisioning creates only the missing dedicated expense and rule once with stable accounting defaults',async()=>{
 for(const[key,number,name,description]of definitions){
  const f=fixture(),account=await nonSaleInventoryExpenseAccount(f.stores,key);
  assert.deepEqual(account,{id:'created-1',account_number:number,name,account_type:'expense',normal_balance:'debit',financial_statement:'income_statement',cash_flow_category:'operating',currency:'XAF',balance:0,is_active:true,is_posting:true,is_system:true});
  assert.deepEqual(f.rows.PostingRule,[{id:'created-2',rule_key:key,label:name,description,account_id:account.id,account_name:name,account_number:number,is_active:true}]);
  assert.deepEqual(f.created.map(row=>row.entity),['Account','PostingRule']);const committed=f.snapshot(),resolved=await resolveNonSaleInventoryExpense(f.stores,key);assert.equal(resolved.needs_account,false);assert.equal(resolved.needs_rule,false);assert.deepEqual(resolved.account,account);assert.deepEqual(resolved.rule,f.rows.PostingRule[0]);assert.deepEqual(resolved.proof.accounts,[account]);
  assert.deepEqual(await nonSaleInventoryExpenseAccount(f.stores,key),account);assert.deepEqual(f.snapshot(),committed);assert.equal(f.created.length,2);
 }
});

test('a valid configured other-expense mapping is honored without replacing its number, balance or rule',async()=>{
 for(const[key]of definitions){
  const account=validAccount({account_type:'other_expense',account_number:'CUSTOM-NONSALE',balance:123.45}),rule={id:'configured-rule',rule_key:key,account_id:account.id,is_active:true,label:'Existing mapping'},f=fixture({Account:[account],PostingRule:[rule],TreasuryAccount:[{id:'unrelated-till',gl_account_id:'unrelated-gl'}]}),before=f.snapshot(),resolved=await resolveNonSaleInventoryExpense(f.stores,key);
  assert.deepEqual(resolved.account,account);assert.deepEqual(resolved.rule,rule);assert.equal(resolved.needs_account,false);assert.equal(resolved.needs_rule,false);assert.deepEqual(resolved.proof,{accounts:[account],rules:[rule],treasury:f.rows.TreasuryAccount});assert.deepEqual(await nonSaleInventoryExpenseAccount(f.stores,key),account);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.created,[]);
 }
});

test('a valid unconfigured dedicated account is reused and only its missing posting rule is provisioned',async()=>{
 for(const[key,number]of definitions){
  const account=validAccount({account_number:number,currency:undefined,name:'Existing dedicated expense',balance:81}),f=fixture({Account:[account]}),resolved=await resolveNonSaleInventoryExpense(f.stores,key);
  assert.equal(resolved.needs_account,false);assert.equal(resolved.needs_rule,true);assert.deepEqual(resolved.account,account);assert.deepEqual(resolved.proof.accounts,[account]);assert.deepEqual(f.created,[]);
  assert.deepEqual(await nonSaleInventoryExpenseAccount(f.stores,key),account);assert.equal(f.rows.Account.length,1);assert.deepEqual(f.rows.Account[0],account);assert.equal(f.rows.PostingRule.length,1);assert.equal(f.rows.PostingRule[0].account_id,account.id);assert.equal(f.rows.PostingRule[0].account_number,number);assert.equal(f.rows.PostingRule[0].account_name,account.name);assert.deepEqual(f.created.map(row=>row.entity),['PostingRule']);
  const committed=f.snapshot();await nonSaleInventoryExpenseAccount(f.stores,key);assert.deepEqual(f.snapshot(),committed);assert.equal(f.created.length,1);
 }
});

test('disabled, incomplete and duplicate mappings are never overridden or reactivated',async()=>{
 for(const[key,number]of definitions){
  for(const rules of [
   [{id:'disabled',rule_key:key,account_id:'configured-expense',is_active:false}],
   [{id:'unspecified-active',rule_key:key,account_id:'configured-expense'}],
   [{id:'active',rule_key:key,account_id:'configured-expense',is_active:true},{id:'also-active',rule_key:key,account_id:'configured-expense',is_active:true}],
   [{id:'active',rule_key:key,account_id:'configured-expense',is_active:true},{id:'disabled',rule_key:key,account_id:'configured-expense',is_active:false}],
   [{id:'missing-account',rule_key:key,account_id:'does-not-exist',is_active:true}],
  ]){
   const f=fixture({Account:[validAccount({account_number:number})],PostingRule:rules}),before=f.snapshot();await assert.rejects(resolveNonSaleInventoryExpense(f.stores,key));await assert.rejects(nonSaleInventoryExpenseAccount(f.stores,key));assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.created,[]);
  }
 }
});

test('invalid configured and fallback accounts fail without any new account, mapping or balance mutation',async()=>{
 const invalids=[{account_type:'asset'},{account_type:'cogs'},{normal_balance:'credit'},{normal_balance:undefined},{is_active:false},{is_posting:false},{is_control_account:true},{is_treasury:true},{account_number:'1050'},{currency:'USD'},{linkedTreasury:true}];
 for(const[key,number]of definitions){
  for(const mapped of [true,false])for(const change of invalids){
   // 1050 is rejected as a mapped expense even when its nominal type is expense.
   // A fallback lookup uses its dedicated number, so that case belongs to the
   // configured mapping rather than inventing a nonexistent fallback match.
   if(!mapped&&change.account_number==='1050')continue;
   const{linkedTreasury,...patch}=change,account=validAccount({account_number:mapped?'CONFIGURED':number,...patch}),f=fixture({Account:[account],PostingRule:mapped?[{id:'rule',rule_key:key,account_id:account.id,is_active:true}]:[],TreasuryAccount:linkedTreasury?[{id:'linked',gl_account_id:account.id,is_active:false}]:[]}),before=f.snapshot();
   await assert.rejects(resolveNonSaleInventoryExpense(f.stores,key));await assert.rejects(nonSaleInventoryExpenseAccount(f.stores,key));assert.deepEqual(f.snapshot(),before,JSON.stringify({key,mapped,change}));assert.deepEqual(f.created,[]);
  }
  const duplicate=fixture({Account:[validAccount({id:'first',account_number:number}),validAccount({id:'second',account_number:number,is_active:false})]}),before=duplicate.snapshot();await assert.rejects(resolveNonSaleInventoryExpense(duplicate.stores,key),/duplicate/);await assert.rejects(nonSaleInventoryExpenseAccount(duplicate.stores,key),/duplicate/);assert.deepEqual(duplicate.snapshot(),before);assert.deepEqual(duplicate.created,[]);
 }
});
