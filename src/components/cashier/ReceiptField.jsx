
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { uploadReceipt, receiptUrl } from "@/lib/field-ops";
import { Camera, Loader2, Paperclip, X } from "lucide-react";

// One receipt, photographed or scanned. Stored privately â€” only the app can read it.
export default function ReceiptField({ fileUri, onChange, label = "Receipt" }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (files) => {
    setBusy(true);
    setError("");
    try {
      onChange(await uploadReceipt(files[0]));
    } catch (e) {
      setError(e.message || sourceMessage("The file could not be uploaded"));
    }
    setBusy(false);
  };

  const open = async () => window.open(await receiptUrl(fileUri), "_blank");

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex items-center gap-3">
        {fileUri ? (
          <div className="relative">
            <button
              type="button"
              onClick={open}
              className="h-16 w-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute -top-2 -right-2 rounded-full bg-slate-900 text-white p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <label className="h-16 w-16 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:border-slate-400">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-5 h-5" />}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
          </label>
        )}
        <p className="text-xs text-slate-500">
          {fileUri ? ui("Receipt attached") : ui("Photograph or scan the receipt")}
          <br />{ui("Stored privately â€” only the app can read the file.")}</p>
      </div>
      {error && <p className="text-sm text-red-600 mt-1">{uiMessage(error)}</p>}
    </div>
  );
}