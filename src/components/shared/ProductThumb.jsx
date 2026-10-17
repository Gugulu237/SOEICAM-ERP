import React from "react";
import { Image } from "@/components/ui/image";
import { Package } from "lucide-react";

// Product photo thumbnail, with a neutral placeholder for items that have no
// picture yet. Used wherever an item is listed or picked.
export default function ProductThumb({ src, name, size = 40, rounded = "rounded-lg", className = "" }) {
  const style = { width: size, height: size };
  if (!src) {
    return (
      <div style={style} className={`${rounded} bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 ${className}`}>
        <Package size={Math.round(size * 0.45)} />
      </div>
    );
  }
  return (
    <div style={style} className={`${rounded} overflow-hidden bg-white border border-slate-200 shrink-0 ${className}`}>
      <Image src={src} alt={name || "Product"} fittingType="fill" className="w-full h-full" />
    </div>
  );
}