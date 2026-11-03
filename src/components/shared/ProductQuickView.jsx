import React from 'react';
import {ui} from '@/lib/i18n';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

// A bounded dialog leaves the catalogue layout intact and supports device Back.
export default function ProductQuickView({title,onClose,children,focusRef}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="flex max-h-[min(65dvh,28rem)] max-w-xs flex-col gap-3 overflow-hidden p-3 sm:max-w-sm sm:p-4"
      onCloseAutoFocus={event=>{if(focusRef?.current?.isConnected){event.preventDefault();focusRef.current.focus({preventScroll:true});}}}>
      <DialogHeader className="shrink-0"><DialogTitle className="break-words text-sm leading-5">{title}</DialogTitle><DialogDescription className="sr-only">{ui('Product quick view')}</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain">{children}</div>
    </DialogContent>
  </Dialog>;
}

