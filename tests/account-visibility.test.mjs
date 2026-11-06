import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAccounts,eligibleAccountParents,buildAccountTree} from '../src/lib/account-hierarchy.js';

const account=(id,extra={})=>({id,account_number:id,name:id,account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,...extra});
const ids=rows=>rows.map(a=>a.id);

test('the default list hides never-used zero accounts and retains settled or reversed accounts',()=>{
  const accounts=[account('unused'),account('settled'),account('reversed'),account('zero-line'),account('cached',{balance:25}),account('opening',{opening_debit:10})];
  const balances={settled:{debit:100,credit:100,entries:2},reversed:{debit:300,credit:300},'zero-line':{debit:0,credit:0,entries:1}};
  const before=structuredClone({accounts,balances});
  assert.deepEqual(ids(visibleAccounts(accounts,balances)),['settled','reversed','zero-line','cached','opening']);
  assert.deepEqual({accounts,balances},before);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{showUnused:true})),ids(accounts));
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{status:'all'})),ids(accounts));
});

test('zero parent headers retain their used descendants and accurate tree totals',()=>{
  const accounts=[account('assets',{is_posting:false}),account('equipment',{parent_id:'assets',is_posting:false,is_hidden:true}),account('freezer',{parent_id:'equipment'}),account('spare',{parent_id:'equipment'}),account('unused-header',{is_posting:false})];
  const balances={freezer:{debit:450,credit:0,entries:1}};
  const shown=visibleAccounts(accounts,balances);
  assert.deepEqual(ids(shown),['assets','equipment','freezer']);
  const tree=buildAccountTree(shown,balances);
  assert.equal(tree.rollups.get('assets'),450);assert.equal(tree.entryCounts.get('equipment'),1);
});

test('explicit list filters and search remain usable without making unused accounts available by accident',()=>{
  const accounts=[account('unused'),account('used'),account('hidden',{is_hidden:true}),account('inactive',{is_active:false}),account('expense',{account_type:'expense'})];
  const balances=Object.fromEntries(['used','hidden','inactive','expense'].map(id=>[id,{debit:10,entries:1}]));
  assert.deepEqual(ids(visibleAccounts(accounts,balances)),['used','expense']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{query:'unused'})),[]);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{query:'unused',showUnused:true})),['unused']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{type:'asset'})),['used']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{status:'hidden'})),['hidden']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{status:'inactive'})),['inactive']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{status:'active'})),['unused','used','hidden','expense']);
});

test('list visibility does not remove active unused or hidden accounts from parent selectors',()=>{
  const accounts=[account('unused'),account('hidden',{is_hidden:true}),account('inactive',{is_active:false}),account('other-type',{account_type:'expense'})];
  assert.deepEqual(visibleAccounts(accounts,{}),[]);
  assert.deepEqual(ids(eligibleAccountParents(accounts,{id:'new',account_type:'asset'})),['hidden','unused']);
  assert.equal(accounts.length,4);assert.equal(accounts[0].is_active,true);assert.equal(accounts[0].is_hidden,undefined);
});

test('nonzero opening values remain discoverable and malformed ancestor cycles terminate',()=>{
  const accounts=[account('first',{parent_id:'second'}),account('second',{parent_id:'first'}),account('legacy',{opening_balance:5}),account('credit',{opening_credit:4}),account('zero-opening',{opening_balance_recorded:true,balance:0})];
  const balances={first:{debit:5,credit:5,entries:2}};
  assert.deepEqual(ids(visibleAccounts(accounts,balances)),['first','second','legacy','credit']);
  assert.deepEqual(ids(visibleAccounts(accounts,balances,{status:'used',showUnused:true})),['first','second','legacy','credit']);
});
