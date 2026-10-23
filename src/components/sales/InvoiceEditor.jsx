
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Input } from '@/components/ui/input';

export default function InvoiceEditor({options,setOptions,dueDate,setDueDate,minDate,saveDefaults,setSaveDefaults,disabled=false}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const field=(key,label,multiline=false)=> <label key={key} className={'block text-xs text-slate-600 '+(multiline?'sm:col-span-2':'')}>{label}{multiline?<textarea disabled={disabled} className="mt-1 w-full rounded-md border bg-white p-2 text-sm" rows={3} maxLength={4000} value={options[key] || ''} onChange={e=>setOptions(o=>({...o,[key]:e.target.value}))}/>:<Input disabled={disabled} className="mt-1" maxLength={500} type={key==='contact_email'?'email':'text'} value={options[key] || ''} onChange={e=>setOptions(o=>({...o,[key]:e.target.value}))}/>}</label>;
  return <fieldset disabled={disabled} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <label className="text-xs text-slate-600">{ui("Document language")}<select aria-label={ui("Document language")} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={options.language||'en'} onChange={e=>setOptions(o=>({...o,language:e.target.value}))}><option value="fr">Français</option><option value="en">English</option></select></label>
    {field('title',ui("Document title"))}{field('reference',ui("Client PO / reference"))}
    {field('bill_to_name',ui("Bill to"))}{field('contact_email',ui("Billing email"))}{field('bill_to_address',ui("Billing address"))}{field('bill_to_tax_id',ui("Client tax ID / NIU"))}
    <label className="text-xs text-slate-600">{ui("Due date")}<Input className="mt-1" aria-label={ui("Invoice due date")} type="date" min={minDate} value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
    <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">{ui("Layout")}<select className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={options.layout} onChange={e=>setOptions(o=>({...o,layout:e.target.value}))}><option value="modern">{ui("Modern")}</option><option value="classic">{ui("Classic")}</option></select></label><label className="text-xs text-slate-600">{ui("Colour")}<select className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm" value={options.accent} onChange={e=>setOptions(o=>({...o,accent:e.target.value}))}><option value="amber">{ui("Brand green")}</option><option value="blue">{ui("Blue")}</option><option value="slate">{ui("Slate")}</option></select></label></div>
    {field('terms',ui("Client terms"),true)}{field('payment_instructions',ui("Payment instructions"),true)}{field('notes',ui("Invoice notes"),true)}{field('footer',ui("Footer message"),true)}
    <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={saveDefaults} onChange={e=>setSaveDefaults(e.target.checked)}/>{ui("Use these terms, payment instructions and style for this client’s future invoices")}</label>
  </fieldset>;
}
