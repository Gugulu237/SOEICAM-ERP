
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, Paperclip, X } from "lucide-react";
import { uploadReceipt, receiptUrl } from "@/lib/field-ops";

const photoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Evidence is stored privately — no public link exists, and only the app can read it.
export default function ReceiptUploader({ fileUris, onChange, reference, onReferenceChange, disabled = false, onBusyChange = undefined, purpose = 'sale' }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState({});
  const uriKey = JSON.stringify(fileUris || []);

  useEffect(() => {
    let active = true;
    const uris = JSON.parse(uriKey);
    Promise.all(uris.map(async (uri) => {
      try { return [uri, await receiptUrl(uri)]; }
      catch { return [uri, '']; }
    })).then((entries) => { if (active) setPreviews(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [uriKey]);

  const add = async (files) => {
    if (disabled || busy || !files?.length) return;
    if ((fileUris?.length || 0) + files.length > 8) {
      setError(sourceMessage("Attach up to 8 receipt photos. Remove a photo before adding another."));
      return;
    }
    if (Array.from(files).some((file) => !photoTypes.has(file.type) || !file.size || file.size > 20 * 1024 * 1024)) {
      setError(sourceMessage("Choose a JPEG, PNG or WebP photograph up to 20 MB. Documents cannot replace the receipt photo."));
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const uris = [];
      for (const file of Array.from(files || [])) uris.push(await uploadReceipt(file));
      onChange([...(fileUris || []), ...uris]);
    } catch (e) {
      setError(e.message || sourceMessage("The file could not be uploaded"));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const open = async (uri) => {
    try {
      const url = await receiptUrl(uri);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { setError(e.message || sourceMessage("The receipt could not be opened")); }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>{purpose === 'return' ? ui("Return / replacement receipt reference *") : ui("Supply receipt number *")}</Label>
        <Input
          aria-label={ui("Supply receipt number")}
          disabled={disabled || busy}
          value={reference || ""}
          onChange={(e) => onReferenceChange(e.target.value)}
          placeholder={ui("e.g. R-10432")}
        />
      </div>

      <div>
        <Label>{ui("Supply receipt photo *")}</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(fileUris || []).map((uri, index) => (
            <div key={uri} className="relative">
              <button
                type="button"
                aria-label={ui("Open supply receipt photo {0}", index + 1)}
                onClick={() => open(uri)}
                className="h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500"
              >
                {previews[uri] ? <img src={previews[uri]} alt={ui("Supply receipt {0}", index + 1)} className="h-full w-full object-cover" onError={() => setPreviews((previous) => ({ ...previous, [uri]: '' }))} /> : <Paperclip className="w-4 h-4" />}
              </button>
              <button
                type="button"
                aria-label={ui("Remove receipt")}
                disabled={disabled || busy}
                onClick={() => onChange(fileUris.filter((u) => u !== uri))}
                className="absolute -top-2 -right-2 rounded-full bg-slate-900 text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          <label className={`h-20 min-w-24 rounded-lg border-2 border-dashed border-slate-300 px-3 flex flex-col items-center justify-center gap-1 text-slate-500 ${disabled || busy ? 'opacity-50' : 'cursor-pointer hover:border-slate-400'}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-5 h-5" />}
            <span className="text-[11px] font-medium">{busy ? ui("Uploading...") : ui("Take photo")}</span>
            <input
              type="file"
              aria-label={ui("Take or attach supply receipt photo")}
              disabled={disabled || busy}
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => { add(e.target.files); e.target.value = ''; }}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-1">{ui("Required to record this ")}{purpose === 'return' ? ui("collection or replacement") : ui("sale")}{ui(". Capture the complete receipt with its number, products and quantities clearly visible. Photos are stored privately.")}</p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{uiMessage(error)}</p>}
    </div>
  );
}
