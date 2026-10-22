// A display mask for the supplied black-backed packshots. The source photos and
// their printed artwork are kept intact; only the surrounding backdrop is hidden.
export function productBackdropMask({ data, width, height }) {
  const count = width * height;
  if (!count || data.length !== count * 4) return null;
  const isBackdrop = (pixel) => {
    const offset = pixel * 4;
    return data[offset + 3] < 8 || Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 70;
  };
  const corners = [0, width - 1, count - width, count - 1];
  if (!corners.every((pixel) => isBackdrop(pixel))) return null;

  const visited = new Uint8Array(count);
  const hidden = new Uint8Array(count);
  const queue = new Int32Array(count);

  // Only border-connected dark pixels are background. Dark lettering within
  // the product is enclosed by the label and must remain visible.
  let head = 0;
  let tail = 0;
  const enqueue = (pixel) => {
    if (!visited[pixel] && isBackdrop(pixel)) {
      visited[pixel] = 1;
      queue[tail++] = pixel;
    }
  };
  const grow = () => {
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      if (x > 0) enqueue(pixel - 1);
      if (x < width - 1) enqueue(pixel + 1);
      if (pixel >= width) enqueue(pixel - width);
      if (pixel < count - width) enqueue(pixel + width);
    }
  };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue(count - width + x); }
  for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  grow();
  for (let i = 0; i < tail; i++) hidden[queue[i]] = 1;

  // Bucket handles enclose an air gap above the body. Limit this exception to
  // large, broad dark regions wholly in the upper part of a packshot, leaving
  // enclosed print and lower label details untouched.
  for (let pixel = 0; pixel < count * 0.45; pixel++) {
    if (visited[pixel] || !isBackdrop(pixel)) continue;
    head = 0; tail = 0; enqueue(pixel); grow();
    let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    for (let i = 0; i < tail; i++) {
      const x = queue[i] % width;
      const y = Math.floor(queue[i] / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (tail > count * 0.012 && maxY < height * 0.45 && maxX - minX > width * 0.15 && maxY - minY > height * 0.04) {
      for (let i = 0; i < tail; i++) hidden[queue[i]] = 1;
    }
  }
  return hidden;
}

export function productMaskSvg(hidden, width, height) {
  if (!hidden) return '';
  const runs = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      while (x < width && hidden[y * width + x]) x++;
      const start = x;
      while (x < width && !hidden[y * width + x]) x++;
      if (x > start) runs.push(`M${start} ${y}h${x - start}v1H${start}z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="white" d="${runs.join('')}"/></svg>`;
}

const displayMasks = new Map();

export function isBundledPackshot(src = '') {
  return /\/products\/yola\/[a-z0-9-]+\.jpg(?:[?#].*)?$/.test(src);
}

export function packshotDisplayMask(image) {
  const source = image.currentSrc || image.src;
  if (displayMasks.has(source)) return displayMasks.get(source);
  // Small masks are enough for product cards and keep decoding off the network.
  const ratio = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return '';
  try {
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const svg = productMaskSvg(productBackdropMask(pixels), width, height);
    const mask = svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : '';
    displayMasks.set(source, mask);
    return mask;
  } catch {
    // Other hosts can disallow pixel reads. Keep their photo usable unchanged.
    return '';
  }
}
