import React,{useEffect,useRef,useState} from 'react';
import { Bell } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNavigate } from '@/lib/router';
import { ui } from '@/lib/i18n';
import { useToast } from '@/components/ui/use-toast';
export default function ProductionNotifications() {
  const {role,user,allowedModules}=useCurrentUser(),navigate=useNavigate(),{toast}=useToast();
  const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[error,setError]=useState('');
  const seen=useRef(new Set()),busy=useRef(false),container=useRef(null);
  const permitted=['admin','production_manager'].includes(role) && (role==='admin' || !allowedModules || allowedModules.includes('manufacturing'));
  useEffect(()=>{
    if(!permitted)return;
    let active=true;const controller=new AbortController();seen.current=new Set();
    const load=async()=>{if(busy.current || document.visibilityState!=='visible')return;busy.current=true;try{const response=await fetch('/api/notifications',{cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error);if(!active)return;setRows(data.notifications);setError('');let announced=0;for(const row of data.notifications){if(!row.read && !seen.current.has(row.id) && announced++<3)toast({title:ui(row.title),description:[row.product_name,row.order_number].filter(Boolean).join(' · ')});seen.current.add(row.id);}}catch(e){if(active && !controller.signal.aborted)setError(e.message);}finally{busy.current=false;}};
    void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);
    return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[permitted,user?.id,toast]);
  useEffect(()=>{if(!open)return;const close=e=>{if(e.key==='Escape' || e.type==='pointerdown' && !container.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[open]);
  if(!permitted)return null;
  const count=rows.filter(r=>!r.read).length;
  const read=async row=>{try{const response=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});if(!response.ok)throw Error((await response.json()).error);setRows(items=>items.map(r=>r.id===row.id?{...r,read:true}:r));setOpen(false);navigate('/manufacturing/'+encodeURIComponent(row.order_id));}catch(e){setError(e.message);}};
  return <div ref={container} className="relative"><button type="button" aria-label={ui('Production notifications')} aria-expanded={open} onClick={()=>setOpen(v=>!v)} className="relative flex h-9 w-9 items-center justify-center rounded-full border text-slate-600"><Bell size={18}/>{(count>0 || error) && <span className="absolute -right-1 -top-1 rounded-full bg-purple-700 px-1.5 text-[10px] text-white">{error?'!':count}</span>}</button>{open && <div className="absolute right-0 z-50 mt-2 max-h-96 w-[min(22rem,85vw)] overflow-auto rounded-lg border bg-white p-3 shadow-lg"><h2 className="mb-2 text-sm font-semibold">{ui('Production notifications')}</h2>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}{!rows.length && !error && <p className="p-3 text-xs text-slate-500">{ui('No fermentation reminders yet.')}</p>}{rows.map(row=><button type="button" key={row.id} onClick={()=>read(row)} className={'mb-1 block w-full rounded-md p-3 text-left text-xs '+(row.read?'bg-slate-50':'bg-purple-50')}><strong>{ui(row.title)}</strong><span className="mt-1 block">{row.product_name} · {row.order_number}</span></button>)}</div>}</div>;
}
