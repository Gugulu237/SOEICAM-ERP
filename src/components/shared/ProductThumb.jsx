
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import Image from 'next/image';
import { Package } from 'lucide-react';
import { productPresentation } from '@/lib/product-images';
import { productPhotoDelivery } from '@/lib/product-photo-delivery';
import { cn } from '@/lib/utils';

/** @param {{product?: Record<string, any>, src?: string, name?: string, className?: string, imageClassName?: string, sizes?: string, priority?: boolean, style?: import('react').CSSProperties}} props */
export function ProductPhoto({ product = {}, src, name, className = '', imageClassName = '', sizes: imageSizes, priority = false, style }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const resolved = src || productPresentation({ ...product, name: product.name || name || product.product_name }).src;
  const [failed, setFailed] = useState('');
  const show = resolved && resolved !== failed;
  const prepared = productPhotoDelivery(resolved);
  // Keep the storefront originals intact while serving a thumbnail at the size
  // used by the catalogue. Other photo sources retain their existing handling.
  const optimize = /^\/products\/soeicam\/[a-z0-9-]+(?:\.\d[a-z0-9-]*)?\.png$/.test(resolved || '');
  const sizes = imageSizes || (typeof style?.width === 'number' && style.width > 0
    ? `${style.width}px`
    : '(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 240px');
  // Both delivery paths occupy the same frame. Absolute positioning prevents
  // a portrait's intrinsic height from stretching a card's aspect-ratio box.
  const imageClasses = cn('absolute inset-0 block h-full w-full object-contain object-center p-2', imageClassName);
  return (
    <div style={style} className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-slate-50', className)}>
      {show && prepared ? <img key={resolved} {...prepared} sizes={sizes} alt={name || product.name || product.product_name || ui("Product")} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} decoding="async" onError={() => setFailed(resolved)} className={imageClasses}/>
        : show && optimize ? <Image key={resolved} src={resolved} alt={name || product.name || product.product_name || ui("Product")} fill sizes={sizes}
        onError={() => setFailed(resolved)} className={imageClasses} />
        : show ? <img key={resolved} src={resolved} alt={name || product.name || product.product_name || ui("Product")} loading="lazy" decoding="async"
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
