import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2 } from "lucide-react";

export default function ItemRowActions({ item, onDeleted }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await base44.entities.Product.delete(item.id);
      toast({ title: "Deleted", description: `${item.name} was removed` });
      setOpen(false);
      onDeleted?.();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setDeleting(false);
  }

  return (
    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
      <Button variant="ghost" size="sm" title="Edit" onClick={() => navigate(`/items/${item.id}`)}>
        <Pencil size={15} />
      </Button>
      <Button variant="ghost" size="sm" title="Delete" className="text-red-500 hover:text-red-700" onClick={() => setOpen(true)}>
        <Trash2 size={15} />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This item will be permanently removed from your item list. Existing stock and past transactions are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}