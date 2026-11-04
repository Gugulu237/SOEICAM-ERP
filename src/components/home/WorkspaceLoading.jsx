import React from 'react';
import {ui} from '@/lib/i18n';

export default function WorkspaceLoading(){
  return <p role="status" className="py-8 text-sm text-slate-500">{ui('Loading...')}</p>;
}
