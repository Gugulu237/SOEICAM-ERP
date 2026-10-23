
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import dynamic from 'next/dynamic';
import {useCurrentUser} from '@/hooks/useCurrentUser';
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
export default function QualityControl({embedded=false}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {role,allowedModules,loading:authLoading,error}=useCurrentUser(),[params,setParams]=useSearchParams(),navigate=useNavigate();
  const requested=(embedded?params.get('quality'):params.get('section')) || (params.get('batch')?'traceability':qualitySections(role)[0]?.key),active=qualitySection(role,requested),sections=qualitySections(role);
  const choose=key=>{const query=new URLSearchParams(params.toString());query.set(embedded?'quality':'section',key);setParams(query);};
  const trace=lot=>navigate(qualityPath('traceability',{batch:lot.lot_number,product:lot.product_id}));
  if(authLoading)return loading();
  if(error || !active || (allowedModules && !allowedModules.includes('quality')))return <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">{error || ui("Your role does not have access to quality and batch monitoring.")}</p>;
  return <div className="space-y-5">{!embedded&&<PageHeader title={ui("Quality Control")} subtitle={ui("Batch release, inspections, expiry risk and customer traceability in one workspace.")}/>}
    {requested!==active.key&&QUALITY_SECTIONS.some(s=>s.key===requested)&&<p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">{ui("That section is not available for your role. Your permitted section is shown below.")}</p>}
    <Tabs value={active.key} onValueChange={choose}><TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">{sections.map(s=>{const Icon=icons[s.key];return <TabsTrigger key={s.key} value={s.key} className="shrink-0 gap-2 rounded-lg px-4 py-2.5 data-[state=active]:bg-primary data-[state=active]:text-white"><Icon size={16}/>{s.label}</TabsTrigger>;})}</TabsList><p className="mt-4 text-sm text-slate-500">{active.description}</p>
      {active.key==='release'&&<TabsContent value="release" className="mt-4"><BatchRelease onTrace={trace}/></TabsContent>}
      {active.key==='inspections'&&<TabsContent value="inspections" className="mt-4"><Inspections onTrace={trace}/></TabsContent>}
      {active.key==='expiry'&&<TabsContent value="expiry" className="mt-4"><Expiry embedded onTrace={trace}/></TabsContent>}
      {active.key==='traceability'&&<TabsContent value="traceability" className="mt-4"><Traceability embedded/></TabsContent>}
    </Tabs></div>;
}
