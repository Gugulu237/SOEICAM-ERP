'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {previewSettings,previewRoute} from '@/lib/preview-state';
import {Smartphone,Tablet,Columns2,RotateCw,RefreshCw,ExternalLink} from 'lucide-react';

const screens=[{id:'mobile',label:'Phone',width:390,height:844,Icon:Smartphone},{id:'tablet',label:'Tablet',width:820,height:1180,Icon:Tablet}];
const sections=[['/inventory?section=items&filter=finished&area=all','Inventory'],['/manufacturing','Manufacturing'],['/team-workspaces?section=people','Employees'],['/commercial','Commercial'],['/','Home'],['/profile','Profile']];
export default function ResponsivePreview({initialSettings=previewSettings()}){
  const [mode,setMode]=useState(initialSettings.mode),[route,setRoute]=useState(initialSettings.route),[phoneWidth,setPhoneWidth]=useState(initialSettings.phoneWidth),[tabletWidth,setTabletWidth]=useState(initialSettings.tabletWidth),[liveRoute,setLiveRoute]=useState(initialSettings.route),[rotated,setRotated]=useState({}),[version,setVersion]=useState(0),[available,setAvailable]=useState(1300),[availableHeight,setAvailableHeight]=useState(1000),[fitted,setFitted]=useState(true);
  const board=useRef(null),frames=useRef({}),latest=useRef(initialSettings.route);
  const persist=useCallback(href=>{const url=new URL(window.location.href);url.searchParams.set('mode',mode);url.searchParams.set('route',href);url.searchParams.set('phone',phoneWidth);url.searchParams.set('tablet',tabletWidth);window.history.replaceState(window.history.state,'',url);},[mode,phoneWidth,tabletWidth]);
  const chooseRoute=href=>{latest.current=href;setRoute(href);setLiveRoute(href);};
  useEffect(()=>{persist(latest.current);},[mode,route,phoneWidth,tabletWidth,persist]);
  useEffect(()=>{const changed=event=>{if(event.origin!==window.location.origin || event.source!==frames.current[mode==='tablet'?'tablet':'mobile']?.contentWindow || event.data?.type!=='soeicam:preview-route')return;const href=previewRoute(event.data.href);if(href){latest.current=href;setLiveRoute(href);persist(href);}};window.addEventListener('message',changed);return()=>window.removeEventListener('message',changed);},[mode,persist]);
  useEffect(()=>{const measureHeight=()=>setAvailableHeight(Math.max(220,window.innerHeight-board.current.getBoundingClientRect().top-window.scrollY-72));const observer=new ResizeObserver(([entry])=>{setAvailable(entry.contentRect.width);measureHeight();});observer.observe(board.current);window.addEventListener('resize',measureHeight);measureHeight();return()=>{observer.disconnect();window.removeEventListener('resize',measureHeight);};},[]);
  const active=screens.map(screen=>screen.id==='mobile'?{...screen,width:phoneWidth,height:({320:720,360:800,390:844,430:932})[phoneWidth]}:{...screen,width:tabletWidth,height:tabletWidth===768?1024:1180}).filter(screen=>mode==='both'||screen.id===mode).map(screen=>rotated[screen.id]?{...screen,width:screen.height,height:screen.width}:screen);
  const total=active.reduce((sum,screen)=>sum+screen.width+2,0)+(active.length-1)*24;
  const together=available>=960,scale=together?Math.min(1,(available-4)/total):null;
  return <main className="min-h-dvh bg-[#f1f4f0] text-slate-900">
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
        <div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-800"><span className="h-2 w-2 rounded-full bg-green-600"/>Live local preview</p><h1 className="mt-1 text-lg font-semibold">SOEICAM · Phone & tablet</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Preview mode">{[['mobile','Phone',Smartphone],['tablet','Tablet',Tablet],['both','Both',Columns2]].map(([value,label,Icon])=><button key={value} onClick={()=>setMode(value)} aria-pressed={mode===value} className={'flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium '+(mode===value?'bg-[#347623] text-white':'text-slate-600 hover:bg-white')}><Icon size={16}/>{label}</button>)}</div>
          <select aria-label="Preview section" value={route} onChange={event=>chooseRoute(event.target.value)} className="h-11 max-w-44 rounded-xl border bg-white px-3 text-sm">{!sections.some(([value])=>value===route)&&<option value={route}>Current workspace</option>}{sections.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Phone width" className="h-11 rounded-xl border bg-white px-2 text-sm" value={phoneWidth} onChange={event=>setPhoneWidth(Number(event.target.value))}>{[320,360,390,430].map(width=><option key={width} value={width}>{width} px phone</option>)}</select>
          {mode!=='mobile'&&<select aria-label="Tablet width" className="h-11 rounded-xl border bg-white px-2 text-sm" value={tabletWidth} onChange={event=>setTabletWidth(Number(event.target.value))}>{[768,820,1024].map(width=><option key={width} value={width}>{width} px tablet</option>)}</select>}
          <button aria-pressed={fitted} onClick={()=>{if(!fitted)window.scrollTo(0,0);setFitted(value=>!value);}} className={"h-11 rounded-xl border px-3 text-sm font-medium "+(fitted?"border-[#347623] bg-[#347623] text-white":"bg-white")}>Fit screen</button>
          <button className="flex h-11 w-11 items-center justify-center rounded-xl border bg-white" title="Reload both previews" aria-label="Reload previews" onClick={()=>setVersion(value=>value+1)}><RefreshCw size={17}/></button>
          <a className="flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-sm" href={liveRoute} target="_blank" rel="noreferrer"><ExternalLink size={16}/><span className="hidden sm:inline">Full app</span></a>
        </div>
      </div>
    </header>
    <div className="mx-auto max-w-[1560px] p-3 sm:p-6"><p className="mb-5 text-sm text-slate-500">The real app at device widths. Source changes appear here automatically.</p>
      <div ref={board} className="flex flex-wrap items-start justify-center gap-6">{active.map(screen=>{
        const zoom=Math.min(scale??Math.min(1,available/(screen.width+2)),fitted?availableHeight/(screen.height+2):1);
        return <section key={screen.id} style={{width:(screen.width+2)*zoom}} className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-2 px-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><screen.Icon size={17}/>{screen.label}<span className="text-xs font-normal text-slate-500">{screen.width} × {screen.height} · {Math.round(zoom*100)}%</span></h2><button className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white" aria-label={'Rotate '+screen.label.toLowerCase()} onClick={()=>setRotated(value=>({...value,[screen.id]:!value[screen.id]}))}><RotateCw size={16}/></button></div>
          <div className="relative" style={{height:(screen.height+2)*zoom}}><div className="absolute left-0 top-0 overflow-hidden rounded-[20px] border border-slate-300 bg-white shadow-lg" style={{width:screen.width+2,height:screen.height+2,transform:`scale(${zoom})`,transformOrigin:'top left'}}><iframe ref={element=>{frames.current[screen.id]=element;}} key={route+version} title={screen.label+' app preview'} src={route} width={screen.width} height={screen.height} className="block border-0 bg-white"/></div></div>
        </section>;
      })}</div>
    </div>
  </main>;
}
