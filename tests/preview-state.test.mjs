import test from 'node:test';
import assert from 'node:assert/strict';
import { previewRoute, previewSettings, previewDefaultRoute } from '../src/lib/preview-state.js';

test('preview bookmarks retain the chosen workspace and supported phone and tablet sizes', () => {
  const route = '/team-workspaces?section=reports&role=commercial&employee=sample';
  assert.deepEqual(previewSettings({ mode: 'mobile', route, phone: '320', tablet: '768' }), { mode: 'mobile', route, phoneWidth: 320, tabletWidth: 768 });
  assert.deepEqual(previewSettings(), { mode: 'both', route: previewDefaultRoute, phoneWidth: 390, tabletWidth: 820 });
  assert.equal(previewSettings({ phone: '-1', tablet: '99999', mode: 'unknown' }).phoneWidth, 390);
});

test('preview frames accept only internal workspace routes and reject recursive, sign-in and API frames', () => {
  for (const value of ['https://other.test/', '//other.test', '/\\other.test', '/api/auth/me', '/auth/callback', '/login', '/dev-preview', '/dev-preview?mode=both', '/%64ev-preview', '/%61pi/files', null]) assert.equal(previewRoute(value), null);
  assert.equal(previewRoute('/customers?view=removed'), '/customers?view=removed');
});


test('the preview renders a bookmarked small-phone workspace without recursive state dependencies', async () => {
  const {build}=await import('esbuild'); const {createRequire}=await import('node:module'); const require=createRequire(import.meta.url);
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Preview from './src/components/dev/ResponsivePreview.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Preview,props));`,loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);
  const html=module.exports.render({initialSettings:previewSettings({mode:'mobile',route:'/customers?view=removed',phone:'320'})});
  assert.match(html,/Phone app preview/);assert.match(html,/width="320"/);assert.match(html,/src="\/customers\?view=removed"/);assert.doesNotMatch(html,/Tablet app preview/);
});
