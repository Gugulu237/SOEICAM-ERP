"use client";

import React,{useRef} from 'react';
// These primitives are already shipped with the app's Radix dropdown menu.
// Reusing its non-modal layer also keeps a picker inside an item-edit dialog
// in the same focus/dismissal stack as that dialog.
import * as Menu from '@radix-ui/react-menu';

export default function PickerPopdown({open=true,anchorRef,onOpenChange,label,children,focusSelector='[data-account-option],[data-component-option],input',compact=false}){
  const contentRef=useRef(null),restoreFocus=useRef(true);
  function interactOutside(event){
    const target=event.detail.originalEvent.target;
    if(anchorRef?.current?.contains(target)){event.preventDefault();return;}
    restoreFocus.current=false;
  }
  return <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
    <Menu.Anchor virtualRef={anchorRef}/>
    <Menu.Portal><Menu.Content ref={contentRef} role="dialog" aria-label={label} align="start" side="bottom" sideOffset={4} collisionPadding={8} sticky="always" hideWhenDetached
      onInteractOutside={interactOutside}
      onEscapeKeyDown={()=>{restoreFocus.current=true;}}
      onOpenAutoFocus={event=>{event.preventDefault();contentRef.current?.querySelector(focusSelector)?.focus({preventScroll:true});}}
      onCloseAutoFocus={event=>{event.preventDefault();if(restoreFocus.current)anchorRef?.current?.focus({preventScroll:true});}}
      className="z-[70] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-lg outline-none"
      style={{boxSizing:'border-box',width:`min(${compact?'17rem':'22rem'}, calc(100vw - 1rem), var(--radix-popper-available-width, calc(100vw - 1rem)))`,maxHeight:compact?'min(16rem, 40dvh, var(--radix-popper-available-height))':'min(24rem, var(--radix-popper-available-height))'}}>
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-2" onKeyDown={event=>event.stopPropagation()}>{children}</div>
    </Menu.Content></Menu.Portal>
  </Menu.Root>;
}
