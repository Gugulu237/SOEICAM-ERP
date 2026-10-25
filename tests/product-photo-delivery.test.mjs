import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let renderer;
async function renderPhoto(src, size, priority = false) {
  renderer ||= build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import ProductThumb, { ProductPhoto } from './src/components/shared/ProductThumb.jsx';
      export function render(src, size, priority) {
        return renderToStaticMarkup(React.createElement(size ? ProductThumb : ProductPhoto,
          {src, size, priority, name:'Yola yogurt', className:'aspect-square'}));
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
  return (await renderer)(src, size, priority);
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

});

test('uploaded, remote and unknown packshots retain their original delivery path', async () => {
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


test('known packshots use ready-to-display WebP sizes without a browser mask', async () => {
  for (const source of ['/products/yola/brasse-nature-500g.jpg', ...['nature','strawberry','vanilla'].map(flavor => '/products/soeicam/stirred-'+flavor+'-2.5kg.png')]) {
    const thumb = await renderPhoto(source, 40);
    assert.match(thumb, /srcSet="[^" ]+\.96\.webp 96w, [^" ]+\.256\.webp 256w, [^" ]+\.512\.webp 512w, [^" ]+\.960\.webp 960w"/);
    assert.match(thumb, /sizes="40px"/);
    assert.match(thumb, /loading="lazy"/);
    assert.doesNotMatch(thumb, /opacity:0|mask-image|data-mask|\/_next\/image/);
    const priority = await renderPhoto(source, undefined, true);
    assert.match(priority, /loading="eager"/);
    assert.match(priority, /fetchPriority="high"/);
  }
});

test('prepared photos exist at their advertised dimensions and card payload is below 10% of originals', async () => {
  const { readFile, stat } = await import('node:fs/promises');
  const sharp = (await import('sharp')).default;
  const assets = JSON.parse(await readFile(new URL('../src/lib/generated/product-photo-assets.json', import.meta.url), 'utf8'));
  let originals = 0, cards = 0;
  assert.equal(Object.keys(assets).length, 31);
  for (const [source, asset] of Object.entries(assets)) {
    originals += (await stat(new URL('../public'+source, import.meta.url))).size;
    assert.deepEqual(asset.variants.map(variant=>variant.width), [96,256,512,960]);
    for (const variant of asset.variants) {
      const file = new URL('../public'+variant.src, import.meta.url);
      const [info, metadata] = await Promise.all([stat(file), sharp(await readFile(file)).metadata()]);
      assert.equal(info.size, variant.bytes);
      assert.equal(metadata.width, variant.width);
      assert.equal(metadata.height, variant.width);
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.hasAlpha, true);
      if (variant.width === 512) cards += info.size;
    }
  }
  assert.ok(cards < originals * 0.1, 'card variants must save at least 90% over originals');
});
