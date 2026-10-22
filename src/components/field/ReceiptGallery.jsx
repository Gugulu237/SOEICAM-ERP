
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { receiptUrl } from "@/lib/field-ops";

export default function ReceiptGallery({ fileUris }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [urls, setUrls] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const resolved = [];
      for (const uri of fileUris || []) {
        try { resolved.push(await receiptUrl(uri)); } catch { /* unreadable file */ }
      }
      if (alive) setUrls(resolved);
    };
    load();
    return () => { alive = false; };
  }, [fileUris]);

  if (!(fileUris || []).length) return <p className="text-sm text-slate-500">{ui("No receipt attached.")}</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer"
          className="h-24 w-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
          {url.match(/\.(pdf)$/i)
            ? <Paperclip className="w-6 h-6 text-slate-500" />
            : <img src={url} alt={ui("Receipt")} className="h-full w-full object-cover" />}
        </a>
      ))}
    </div>
  );
}