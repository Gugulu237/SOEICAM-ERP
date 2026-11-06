import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const output = await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Notice,{exchangePackagingWarningText} from './src/components/field/ExchangePackagingNotice.jsx';export const render=record=>renderToStaticMarkup(React.createElement(Notice,{record}));export const text=exchangePackagingWarningText;",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false});
const m={exports:{}};
new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);

test('completed sales expose recovery warnings without reporting a failed sale',()=>{
  assert.equal(m.exports.render({}), '');
  assert.equal(m.exports.text({exchange_packaging_warnings:[]}), '');
  const warning={product_name:'Yogurt <cup>',message:'Packaging mapping is missing.'};
  const record={exchange_packaging_warnings:[warning,warning]};
  assert.equal(m.exports.text(record),'Packaging recovery needs review. Yogurt <cup>: Packaging mapping is missing.');
  const html=m.exports.render(record);
  assert.match(html,/role="status"/);
  assert.match(html,/Yogurt &lt;cup&gt;/);
  assert.equal((html.match(/Packaging mapping is missing/g)||[]).length,1);
});
