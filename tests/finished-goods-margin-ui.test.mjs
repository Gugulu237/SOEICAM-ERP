import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {finishedGoodsMargin} from '../src/lib/finished-goods-margin.js';
const require=createRequire(import.meta.url);
const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Margin from './src/components/items/FinishedGoodsMargin.jsx';import Groups from './src/components/inventory/GroupedItems.jsx';import Mobile from './src/components/inventory/MobileStockList.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({Margin,Groups,Mobile}[kind],props));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
const product={id:'yola',name:'YOLA 500g',inventory_type:'assembly',unit_of_measure:'ea',selling_price:1192.5,current_cost:600};
const margin=finishedGoodsMargin(product);
test('the quick margin details show the entered sales price and production cost without tax calculations or labels',()=>{
 const html=mod.exports.render('Margin',{value:margin});assert.match(html,/Finished product margin/);assert.match(html,/Sales price/);assert.match(html,/Production cost \/ unit/);assert.match(html,/Gross profit \/ unit/);assert.match(html,/49\.7%/);assert.match(html,/registered unit cost/);assert.match(html,/Based on the current catalogue price and production cost, before operating expenses\./);assert.match(html,/Actual sales margins may differ with discounts and the batches sold\./);assert.doesNotMatch(html,/VAT|TVA|Net sales price|Net selling price/i);
 assert.equal(mod.exports.render('Margin',{}),'');
 const missing=mod.exports.render('Margin',{value:finishedGoodsMargin({...product,current_cost:0}),compact:true});assert.match(missing,/Not available/);assert.doesNotMatch(missing,/100%/);
});
test('desktop cards and phone inventory rows show the finished margin immediately without opening an item editor',()=>{
 const item={...product,current_cost:999,finished_goods_margin:margin};
 const desktop=mod.exports.render('Groups',{products:[item],filter:'finished',quantities:new Map([['yola',4]]),balances:[]});assert.match(desktop,/Gross margin/);assert.match(desktop,/49\.7%/);
 const phone=mod.exports.render('Mobile',{rows:[{item,variant:{size:'500 g'},group:'YOLA'}],quantities:new Map([['yola',4]])});assert.match(phone,/Gross margin/);assert.match(phone,/49\.7%/);assert.match(phone,/Production cost \/ unit/);assert.doesNotMatch(phone,/999 FCFA/);
 const restricted=mod.exports.render('Mobile',{rows:[{item:product,variant:{size:'500 g'},group:'YOLA'}],quantities:new Map()});assert.doesNotMatch(restricted,/Gross margin/);
});
