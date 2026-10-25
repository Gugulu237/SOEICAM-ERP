import React, { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Keep explanations available to touch and keyboard users without filling the
// phone screen. Desktop retains the original inline explanation.
export default function MobileInfo({ title, children, className = '', desktopClassName = '', mobileOnly = false }) {
  const [open, setOpen] = useState(false);
  return <div className={className}>
    {!mobileOnly && <div className={'hidden sm:block ' + desktopClassName}>{children}</div>}
    <div className="sm:hidden">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={ui('More information: {0}', title)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><CircleAlert size={16} aria-hidden="true" /></button><Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80dvh] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl p-5" aria-describedby={undefined}><DialogHeader><DialogTitle className="pr-6 text-sm leading-5">{title}</DialogTitle></DialogHeader><div className="space-y-2 text-xs leading-5 text-slate-600">{children}</div></DialogContent>
      </Dialog>
    </div>
  </div>;
}
