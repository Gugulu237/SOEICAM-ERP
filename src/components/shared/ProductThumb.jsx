
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import Image from 'next/image';
import { Package } from 'lucide-react';
import { productPresentation } from '@/lib/product-images';
import { isBundledPackshot, packshotDisplayMask } from '@/lib/product-photo-mask';
import { cn } from '@/lib/utils';

/** @param {{product?: Record<string, any>, src?: string, name?: string, className?: string, imageClassName?: string, sizes?: string, style?: import('react').CSSProperties}} props */
export function ProductPhoto({ product = {}, src, name, className = '', imageClassName = '', sizes: imageSizes, style }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const resolved = src || productPresentation({ ...product, name: product.name || name || product.product_name }).src;
  const [failed, setFailed] = useState('');
  const [display, setDisplay] = useState({ src: '', mask: '' });
  const show = resolved && resolved !== failed;
  const needsMask = isBundledPackshot(resolved);
  const ready = !needsMask || display.src === resolved;
  const mask = needsMask && ready ? display.mask : '';
  // Keep the storefront originals intact while serving a thumbnail at the size
  // used by the catalogue. Other photo sources retain their existing handling.
  const optimize = /^\/products\/soeicam\/[a-z0-9-]+(?:\.\d[a-z0-9-]*)?\.png$/.test(resolved || '');
  const sizes = imageSizes || (typeof style?.width === 'number' && style.width > 0
    ? `${style.width}px`
    : '(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 240px');
  // Both delivery paths occupy the same frame. Absolute positioning prevents
  // a portrait's intrinsic height from stretching a card's aspect-ratio box.
  // The mask uses the same padded content box as object-fit: contain.
  const imageClasses = cn('absolute inset-0 block h-full w-full object-contain object-center p-2', imageClassName);
  return (
    <div style={style} className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-slate-50', className)}>
      {show && optimize ? <Image key={resolved} src={resolved} alt={name || product.name || product.product_name || ui("Product")} fill sizes={sizes}
        onError={() => setFailed(resolved)} className={imageClasses} />
        : show ? <img key={resolved} src={resolved} alt={name || product.name || product.product_name || ui("Product")} loading="lazy" decoding="async"
        onLoad={(event) => { if (needsMask) setDisplay({ src: resolved, mask: packshotDisplayMask(event.currentTarget) }); }}
        style={{ opacity: ready ? 1 : 0, ...(mask ? { maskImage: mask, WebkitMaskImage: mask, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', maskOrigin: 'content-box', WebkitMaskOrigin: 'content-box', maskClip: 'content-box', WebkitMaskClip: 'content-box' } : {}) }}
        onError={() => setFailed(resolved)} className={imageClasses} />
        : <Package aria-hidden="true" className="h-1/3 w-1/3 max-h-12 max-w-12 text-slate-400" />}
    </div>
  );
}

/** @param {{product?: Record<string, any>, src?: string, name?: string, size?: number, rounded?: string, className?: string}} props */
export default function ProductThumb({ product, src, name, size = 40, rounded = 'rounded-lg', className = '' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <ProductPhoto product={product} src={src} name={name} style={{ width: size, height: size }} className={`${rounded} ${className}`} imageClassName="p-1" />;
}
