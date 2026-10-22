import React, { useEffect, useRef, useState } from 'react';
import PickerPopdown from '@/components/ui/picker-popdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ACCOUNT_TYPES } from '@/lib/account-hierarchy';
import { ui } from '@/lib/i18n';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const allowed = account => account.is_active !== false && account.is_posting !== false && account.allow_manual_journal !== false;
const accountType = account => ACCOUNT_TYPES.some(type => type.value === account.account_type) ? account.account_type : 'other';

export function journalAccountGroups(accounts) {
  const eligible = accounts.filter(allowed);
  return [...ACCOUNT_TYPES.map(type => ({ value: type.value, label: type.label })), { value: 'other', label: ui('Other accounts') }]
    .map(type => ({ ...type, count: eligible.filter(account => accountType(account) === type.value).length }))
    .filter(type => type.count > 0);
}

export function matchingJournalAccounts(accounts, group, query) {
  const needle = normalize(query);
  return accounts.filter(account => allowed(account) && (!group || accountType(account) === group)
    && (!needle || normalize(`${account.account_number || ''} ${account.name || ''}`).includes(needle)))
    .sort((a, b) => String(a.account_number || '').localeCompare(String(b.account_number || ''), undefined, { numeric: true }) || String(a.name || '').localeCompare(String(b.name || '')));
}

// Native buttons support Tab/Enter; arrows also move through the current results.
export function movePickerFocus(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (['Home', 'End'].includes(event.key) && event.target.tagName === 'INPUT') return;
  const buttons = [...event.currentTarget.querySelectorAll('[data-account-option]')];
  if (!buttons.length) return;
  const current = buttons.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : event.key === 'ArrowDown' ? (current + 1) % buttons.length : current <= 0 ? buttons.length - 1 : current - 1;
  event.preventDefault();
  buttons[next].focus();
}

export default function JournalAccountPicker({ open, accounts, selectedId, onSelect, onOpenChange, lineNumber, returnFocusRef }) {
  const searchInput = useRef(null),resultsRef=useRef(null),focusResults=useRef(false);
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(80);
  const changeGroup = value => { focusResults.current=true;setGroup(value);setQuery('');setLimit(80); };
  const goBack=()=>{if(query){focusResults.current=true;setQuery('');setLimit(80);}else changeGroup('');};
  const changeQuery = value => { setQuery(value); setLimit(80); };
  const clearSearch = () => { changeQuery(''); searchInput.current?.focus(); };
  useEffect(()=>{if(resultsRef.current)resultsRef.current.scrollTop=0;if(focusResults.current){resultsRef.current?.querySelector('[data-account-option]')?.focus({preventScroll:true});focusResults.current=false;}},[group,query]);
  const groups = journalAccountGroups(accounts);
  const selectedGroup = groups.find(type => type.value === group);
  const showAccounts = Boolean(group || query.trim());
  const matches = showAccounts ? matchingJournalAccounts(accounts, group, query) : [];
  return <PickerPopdown open={open} anchorRef={returnFocusRef} onOpenChange={onOpenChange} label={ui('Choose account for line {0}',lineNumber)}>
      <div className="flex shrink-0 items-center gap-2"><Button type="button" variant="ghost" size="sm" aria-label={ui('Previous account options')} disabled={!group&&!query} onClick={goBack}>← {ui('Back')}</Button><span className="min-w-0 truncate text-sm font-semibold">{selectedGroup?.label || ui('Account types')}</span></div>
      <div className="flex min-h-0 min-w-0 flex-col gap-3" onKeyDown={movePickerFocus}>
        <div className="flex gap-2">
          <Input ref={searchInput} aria-label={ui('Search accounts')} value={query} placeholder={ui('Account number or name')} onChange={event => changeQuery(event.target.value)} />
          {query && <Button type="button" variant="ghost" onClick={clearSearch}>{ui('Clear search')}</Button>}
        </div>
        {group && <div className="flex flex-wrap items-center gap-2 text-sm"><Button type="button" variant="ghost" size="sm" onClick={() => changeGroup('')}>{ui('All account types')}</Button><span className="text-slate-500">/ {selectedGroup?.label}</span></div>}
        <div ref={resultsRef} className="min-h-0 max-h-60 shrink overflow-y-auto overscroll-contain rounded border">
          {!showAccounts ? groups.map(type => <button type="button" data-account-option key={type.value} className="flex min-h-10 w-full items-center justify-between gap-3 border-b px-2 py-2 text-left text-sm last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => changeGroup(type.value)}><span className="font-medium">{type.label}</span><span className="text-slate-500">{type.count}</span></button>) : matches.slice(0, limit).map(account => <button type="button" data-account-option key={account.id} aria-pressed={selectedId === account.id} className="flex min-h-10 w-full items-start gap-3 border-b px-2 py-2 text-left text-sm last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 aria-pressed:bg-blue-50" onClick={() => onSelect(account.id)}><span className="shrink-0 font-mono font-medium">{account.account_number}</span><span className="min-w-0 break-words">{account.name}</span></button>)}
          {showAccounts&&matches.length>limit&&<button type="button" data-account-option className="w-full p-3 text-center text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" onClick={()=>setLimit(value=>value+80)}>{ui('Show more accounts ({0} remaining)',matches.length-limit)}</button>}
          {(!groups.length || showAccounts && !matches.length) && <p role="status" className="p-4 text-sm text-slate-500">{ui('No matching posting accounts.')}</p>}
        </div>
        <div className="flex justify-end gap-2">{selectedId && <Button type="button" variant="ghost" onClick={() => onSelect('')}>{ui('Clear account')}</Button>}<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{ui('Cancel')}</Button></div>
      </div>
  </PickerPopdown>;
}
