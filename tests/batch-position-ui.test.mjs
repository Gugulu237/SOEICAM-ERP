import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

test('T view presents both sides, signed contra balances, equity and an honest imbalance',async()=>{
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Position from './src/components/accounting/AccountPosition.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Position,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  const accounts=[{id:'cash',account_number:'1000',name:'Cash',account_type:'asset'},{id:'depreciation',account_number:'1510',name:'Accumulated depreciation',account_type:'asset'},{id:'debt',account_number:'2000',name:'Suppliers',account_type:'liability'},{id:'capital',account_number:'3000',name:'Capital',account_type:'equity'}];
  const balances={cash:{debit:1000,credit:0},depreciation:{debit:0,credit:100},debt:{debit:0,credit:400},capital:{debit:0,credit:500}};
  const html=module.exports.render({accounts,balances,date:'2026-10-18'});
  assert.match(html,/T-shaped financial position/);assert.match(html,/md:grid-cols-2/);assert.match(html,/md:border-l-2/);assert.match(html,/Accumulated depreciation/);assert.match(html,/-100/);assert.match(html,/Total liabilities &amp; equity/);assert.match(html,/Assets equal liabilities plus equity/);
  assert.match(module.exports.render({accounts,balances:{...balances,cash:{debit:1100,credit:0}}}),/Difference:/);
});

test('expiry cards expose a batch-specific customer trace without changing stock',async()=>{
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Triage from './src/components/inventory/ExpiryTriage.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Triage,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  const row={id:'batch',product_id:'product',product_name:'YOLA',lot_number:'B-01',quantity:20,risk:'expired',warehouse_name:'Cold room',expiry_date:'2026-10-01'};
  const html=module.exports.render({rows:[row],onTrace:()=>{}});assert.match(html,/B-01/);assert.match(html,/Trace customer supplies/);
  assert.equal(module.exports.render({rows:[row]}).includes('Trace customer supplies'),false,'staff without trace permission do not get a blocked action');
});
