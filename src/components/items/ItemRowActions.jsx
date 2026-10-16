import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, Power } from "lucide-react";

export default function ItemRowActions({ item, onChanged, editPath }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = item.is_active !== false;

  async function toggleActive() {
    setBusy(true);
    try {
      await base44.entities.Product.update(item.id, { is_active: !active });
      toast({ title: active ? "Deactivated" : "Activated", description: `${item.name} is now ${active ? "inactive" : "active"}` });
      onChanged?.();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await base44.entities.Product.delete(item.id);
      toast({ title: "Deleted", description: `${item.name} was removed` });
      setOpen(false);
      onChanged?.();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
      <Button variant="ghost" size="sm" title="Edit" onClick={() => navigate(editPath || `/items/${item.id}`)}>
        <Pencil size={15} />
      </Button>
      <Button
        variant="ghost" size="sm" disabled={busy}
        title={active ? "Deactivate" : "Activate"}
        className={active ? "text-slate-500 hover:text-amber-600" : "text-emerald-600 hover:text-emerald-700"}
        onClick={toggleActive}
      >
        <Power size={15} />
      </Button>
      <Button variant="ghost" size="sm" title="Delete" className="text-red-500 hover:text-red-700" onClick={() => setOpen(true)}>
        <Trash2 size={15} />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This item will be permanently removed. If you just want to stop using it, deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}