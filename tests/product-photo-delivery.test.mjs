import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let renderer;
async function renderPhoto(src, size) {
  renderer ||= build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import ProductThumb, { ProductPhoto } from './src/components/shared/ProductThumb.jsx';
      export function render(src, size) {
        return renderToStaticMarkup(React.createElement(size ? ProductThumb : ProductPhoto,
          {src, size, name:'Yola yogurt', className:'aspect-square'}));
      }
    `, resolveDir: process.cwd(), loader: 'jsx' },
    alias: { '@': process.cwd() + '/src' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
    // Match Next's default-export interop while retaining the real Image
    // component and responsive image loader in this standalone SSR bundle.
    plugins: [{ name: 'next-image-entry', setup(builder) {
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next-image-entry', namespace: 'image-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'image-test' }, () => ({
        contents: "export { Image as default } from 'next/dist/client/image-component.js';",
        resolveDir: process.cwd(),
      }));
    } }],
  }).then(output => {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
    return module.exports.render;
  });
  return (await renderer)(src, size);
}

test('storefront PNGs use responsive Next thumbnails sized for cards and small table images', async () => {
  const source = '/products/soeicam/yola-125g.png';
  const thumb = await renderPhoto(source, 40);
  assert.match(thumb, /sizes="40px"/);
  assert.match(thumb, /srcSet="[^"]*\/_next\/image\?url=%2Fproducts%2Fsoeicam%2Fyola-125g\.png/);
  assert.match(thumb, /data-nimg="fill"/);
  assert.match(thumb, /object-contain/);
  assert.match(thumb, /alt="Yola yogurt"/);
  assert.match(thumb, /loading="lazy"/);
  const card = await renderPhoto(source);
  assert.match(card, /sizes="\(max-width: 639px\) 45vw, \(max-width: 1023px\) 30vw, 240px"/);
  assert.match(card, /srcSet=/);
  for (const flavor of ['nature', 'strawberry', 'vanilla']) {
    const decimalSize = await renderPhoto(`/products/soeicam/stirred-${flavor}-2.5kg.png`, 40);
    assert.match(decimalSize, /srcSet="[^\"]*\/_next\/image\?/);
    assert.match(decimalSize, /sizes="40px"/);
  }
});

test('uploaded, remote and legacy masked packshots retain their original delivery path', async () => {
  for (const source of [
    'https://storage.example.test/product.png',
    '/products/yola/yogurt.jpg',
    '/products/soeicam/../yola/yogurt.png',
    '/products/soeicam/yola..png',
    '/products/soeicam/stirred-2.5.5kg.png',
    '/products/soeicam/yola.png?external=1',
  ]) {
    const markup = await renderPhoto(source, 40);
    assert.ok(markup.includes(`src="${source}"`));
    assert.doesNotMatch(markup, /\/_next\/image\?|srcSet=|data-nimg=/);
  }
});
