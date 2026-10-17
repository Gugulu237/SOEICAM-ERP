import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ROLE_DEFINITIONS, ROLE_CATEGORIES } from "@/lib/permissions";
import { modulesForRole } from "@/lib/appModules";
import RoleBadge from "./RoleBadge";

// Read-only map of every system role: what it is responsible for and what it can open.
export default function RoleAccessReference({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roles & Feature Access</DialogTitle>
          <DialogDescription>
            Assign one of these roles to each employee. The role decides which modules they can open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {ROLE_CATEGORIES.map(cat => (
            <div key={cat}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat}</div>
              <div className="space-y-3">
                {ROLE_DEFINITIONS.filter(r => r.category === cat).map(def => {
                  const modules = modulesForRole(def.key);
                  return (
                    <div key={def.key} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <RoleBadge role={def.key} />
                          <span className="text-sm text-slate-500">{def.summary}</span>
                        </div>
                        <span className="text-xs text-slate-400">{modules.length} modules</span>
                      </div>
                      <ul className="mt-3 space-y-1">
                        {def.duties.map((duty, i) => (
                          <li key={i} className="flex gap-2 text-sm text-slate-600">
                            <span className="text-slate-300">•</span>{duty}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {modules.map(m => (
                          <span key={m.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.label}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}