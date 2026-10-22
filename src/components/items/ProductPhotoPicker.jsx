
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { ImagePlus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import { PRODUCT_PHOTOS, normalizeProductText, productPresentation } from '@/lib/product-images';

export default function ProductPhotoPicker({ product, onChange }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = productPresentation(product);
  const photos = PRODUCT_PHOTOS.filter((p) => normalizeProductText(`${p.name} ${p.size}`).includes(normalizeProductText(search)));
  return <>
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <ProductPhoto product={product} className="h-24 w-24 rounded-xl" imageClassName="p-1" />
      <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-900">{ui("Product photo")}</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">{ui("Used in the catalog, field POS and stock lists.")}</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><ImagePlus size={15} className="mr-2" />{ui("Choose photo")}</Button>
          {product.image_url && <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>{ui("Use automatic match")}</Button>}</div>
        <p className="mt-2 text-xs text-slate-500">{product.image_url ? ui("Selected photo") : current.src ? ui("Matched by product name, flavor and size") : ui("No matching photo yet")}</p>
      </div>
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{ui("Choose a YOLA product photo")}</DialogTitle><DialogDescription>{ui("Match the flavor and pack size to this item. Product quantities and components stay on the item record.")}</DialogDescription></DialogHeader>
      <Input aria-label={ui("Search product photos")} placeholder={ui("Search flavor or size…")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo) => <button key={photo.id} type="button" onClick={() => { onChange(photo.src); setOpen(false); }}
          className={`overflow-hidden rounded-xl border text-left focus-visible:ring-2 focus-visible:ring-amber-500 ${current.src === photo.src ? 'border-amber-500 ring-2 ring-amber-400' : 'border-slate-200'}`}>
          <ProductPhoto src={photo.src} name={photo.name} className="aspect-square w-full" imageClassName="p-2" />
          <div className="p-3"><div className="flex items-center justify-between text-xs font-semibold">{photo.size}{current.src === photo.src && <Check size={14} />}</div>
            <p className="mt-1 text-sm">{photo.name}</p>{photo.manualOnly && <p className="mt-1 text-xs text-amber-700">{ui("Filename says 330 ml; label reads 220 g. Verify before selecting.")}</p>}</div>
        </button>)}
      </div>
      {!photos.length && <p className="py-8 text-center text-sm text-slate-500">{ui("No matching photos.")}</p>}
    </DialogContent></Dialog>
  </>;
}
