import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, Paperclip, X } from "lucide-react";
import { uploadReceipt, receiptUrl } from "@/lib/field-ops";

// Evidence is stored privately — no public link exists, and only the app can read it.
export default function ReceiptUploader({ fileUris, onChange, reference, onReferenceChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async (files) => {
    setBusy(true);
    setError("");
    try {
      const uris = [];
      for (const file of Array.from(files || [])) uris.push(await uploadReceipt(file));
      onChange([...(fileUris || []), ...uris]);
    } catch (e) {
      setError(e.message || "The file could not be uploaded");
    } finally {
      setBusy(false);
    }
  };

  const open = async (uri) => {
    const url = await receiptUrl(uri);
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Receipt reference *</Label>
        <Input
          value={reference || ""}
          onChange={(e) => onReferenceChange(e.target.value)}
          placeholder="e.g. R-10432"
        />
      </div>

      <div>
        <Label>Receipt photograph or scan *</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {(fileUris || []).map((uri) => (
            <div key={uri} className="relative">
              <button
                type="button"
                onClick={() => open(uri)}
                className="h-16 w-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onChange(fileUris.filter((u) => u !== uri))}
                className="absolute -top-2 -right-2 rounded-full bg-slate-900 text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}

          <label className="h-16 w-16 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-500 cursor-pointer hover:border-amber-400">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-5 h-5" />}
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => add(e.target.files)}
            />
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Stored privately — only the app can read the file. Approval needs at least one clear image.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}