import React from 'react';
import {ui} from '@/lib/i18n';

export default function WorkspaceLoading({label='Loading your workspace…'}){
  return <div role="status" aria-live="polite" className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
    <span className="sr-only">{ui(label)}</span>
    <div aria-hidden="true" className="space-y-4">
      <div className="h-6 w-40 rounded-lg bg-muted"/>
      <div className="grid grid-cols-2 gap-3">{[0,1].map(key=><div key={key} className="h-24 rounded-xl border bg-card p-4"><div className="h-3 w-20 rounded bg-muted"/><div className="mt-4 h-5 w-24 rounded bg-muted"/></div>)}</div>
      {[0,1,2].map(key=><div key={key} className="h-14 rounded-xl border bg-card p-4"><div className="h-3 w-2/3 rounded bg-muted"/></div>)}
    </div>
  </div>;
}
