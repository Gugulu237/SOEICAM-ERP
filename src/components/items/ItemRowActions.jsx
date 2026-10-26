
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import ItemRemoval from './ItemRemoval';
import { Pencil, Power, Factory } from "lucide-react";

export default function ItemRowActions({ item, onChanged, editPath, onBuild, onEdit }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const active = item.is_active !== false;
  const draft = item.configuration_status === "draft";

  async function toggleActive() {
    if (draft) { if (onEdit) onEdit(item); else navigate(editPath || `/items/${item.id}`); return; }
    setBusy(true);
    try {
      await erp.entities.Product.update(item.id, { is_active: !active });
      toast({ title: active ? "Deactivated" : "Activated", description: ui("{0} is now {1}", item.name, active ? "inactive" : "active") });
      onChanged?.();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
      {onBuild && active && !draft && <Button size="sm" onClick={onBuild}><Factory size={14} className="mr-1"/>{ui('Build assembly')}</Button>}
      <Button variant="ghost" size="sm" title={ui("Edit")} aria-label={ui('Edit {0}',item.name)} onClick={() => onEdit ? onEdit(item) : navigate(editPath || `/items/${item.id}`)}>
        <Pencil size={15} />
      </Button>
      <Button
        variant="ghost" size="sm" disabled={busy}
        title={draft ? ui("Finish assembly setup") : active ? ui("Deactivate") : ui("Activate")}
        className={active ? "text-slate-500 hover:text-slate-600" : "text-emerald-600 hover:text-emerald-700"}
        onClick={toggleActive}
      >
        <Power size={15} />
      </Button>
      <ItemRemoval item={item} disabled={busy} onBusyChange={setBusy} onDone={()=>onChanged?.()}/>
    </div>
  );
}
