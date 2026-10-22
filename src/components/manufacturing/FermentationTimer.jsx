import React,{useEffect,useState} from 'react';
import { fermentationRemaining } from '@/lib/fermentation';
import { ui } from '@/lib/i18n';
export default function FermentationTimer({order}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  if(order?.status!=='in_production' || order.yogurt_phase && order.yogurt_phase!=='fermentation')return null;
  const minutes=fermentationRemaining(order,now);
  return <p role="timer" className="mt-2 rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-900">{minutes===null?ui('Start the fermentation timer for this batch.'):minutes===0?ui('8-hour fermentation timer complete — verify the batch before recording output.'):ui('Under fermentation · {0}h {1}m remaining',Math.floor(minutes/60),minutes%60)}</p>;
}
