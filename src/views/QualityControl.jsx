
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import dynamic from 'next/dynamic';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {useNavigate,useSearchParams} from '@/lib/router';
import {QUALITY_SECTIONS,qualitySection,qualitySections,qualityPath} from '@/lib/quality-workspace';
import PageHeader from '@/components/shared/PageHeader';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {ShieldCheck,ClipboardCheck,CalendarClock,GitBranch} from 'lucide-react';
const loading=()=> <p role="status" className="p-10 text-center text-sm text-slate-500">{ui("Loading this section...")}</p>;
const BatchRelease=dynamic(()=>import('@/components/quality/BatchReleasePanel'),{loading});
const Inspections=dynamic(()=>import('@/components/quality/QualityInspections'),{loading});
const Expiry=dynamic(()=>import('@/views/ExpiryRisk'),{loading});
const Traceability=dynamic(()=>import('@/views/BatchTrace'),{loading});
const icons={release:ShieldCheck,inspections:ClipboardCheck,expiry:CalendarClock,traceability:GitBranch};
export default function QualityControl({embedded=false,tracking=false,defaultSection}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();

  const {role,allowedModules,loading:authLoading,error}=useCurrentUser(),[params,setParams]=useSearchParams(),navigate=useNavigate();
  const sections=qualitySections(role),fallback=sections.some(section=>section.key===defaultSection)?defaultSection:sections[0]?.key;
  const requested=(embedded?params.get('quality'):params.get('section')) || (params.get('batch')?'traceability':fallback),active=qualitySection(role,requested);
  const primary=tracking?sections.filter(section=>['expiry','traceability'].includes(section.key)):sections,secondary=tracking?sections.filter(section=>!['expiry','traceability'].includes(section.key)):[];
  const choose=key=>{const query=new URLSearchParams(params.toString());query.set(embedded?'quality':'section',key);setParams(query);};
  const trace=lot=>navigate(qualityPath('traceability',{batch:lot.lot_number,product:lot.product_id}));
  if(authLoading)return loading();
  if(error || !active || (allowedModules && !allowedModules.includes('quality')))return <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">{error || ui("Your role does not have access to quality and batch monitoring.")}</p>;
  const navigationFor=items=><><TabsList className={tracking?"grid h-auto w-full gap-1 rounded-xl border border-slate-200 bg-white p-2 "+(items.length===1?"grid-cols-1":"grid-cols-2"):"h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2"}>{items.map(s=>{const Icon=icons[s.key];return <TabsTrigger key={s.key} value={s.key} className={(tracking?"min-h-11 min-w-0 whitespace-normal gap-1 px-2 text-xs ":"shrink-0 gap-2 px-4 ")+"rounded-lg py-2.5 data-[state=active]:bg-primary data-[state=active]:text-white"}><Icon size={16}/>{tracking?ui(s.key==='traceability'?'Batches':s.key==='expiry'?'Expiry dates':s.label):s.label}</TabsTrigger>;})}</TabsList>{!tracking&&<p className="mt-4 text-sm text-slate-500">{ui(active.description)}</p>}</>;
  const navigation=navigationFor(primary);
  return <div className="space-y-5">{tracking&&!params.get('batch')&&<header className="min-h-14 pr-24"><h1 className="text-xl font-bold">{ui('Batches & expiry')}</h1></header>}{!embedded&&!phone&&<PageHeader title={ui("Quality Control")} subtitle={ui("Batch release, inspections, expiry risk and customer traceability in one workspace.")}/>}
    {requested!==active.key&&QUALITY_SECTIONS.some(s=>s.key===requested)&&<p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">{ui("That section is not available for your role. Your permitted section is shown below.")}</p>}
    <Tabs value={active.key} onValueChange={choose}>{(!phone||tracking)&&navigation}
      {active.key==='release'&&<TabsContent value="release" className="mt-4"><BatchRelease onTrace={trace}/></TabsContent>}
      {active.key==='inspections'&&<TabsContent value="inspections" className="mt-4"><Inspections onTrace={trace}/></TabsContent>}
      {active.key==='expiry'&&<TabsContent value="expiry" className={phone?"mt-0":"mt-4"}><Expiry embedded onTrace={trace}/></TabsContent>}
      {active.key==='traceability'&&<TabsContent value="traceability" className={phone?"mt-0":"mt-4"}><Traceability embedded/></TabsContent>}
    {phone&&!tracking&&<details className="mt-4 rounded-[22px] border bg-white p-4"><summary className="min-h-6 cursor-pointer text-xs font-semibold">{ui('Quality & batches')}</summary><div className="mt-3">{navigation}</div></details>}{tracking&&secondary.length>0&&<details open={secondary.some(section=>section.key===active.key)} className="mt-4 rounded-[22px] border bg-white p-4"><summary className="min-h-6 cursor-pointer text-xs font-semibold">{ui('Quality controls')}</summary><div className="mt-3">{navigationFor(secondary)}</div></details>}</Tabs></div>;
}
