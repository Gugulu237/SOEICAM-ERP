'use client';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {useNavigate} from '@/lib/router';
import {traceBatch} from '@/lib/traceability';
import MobileBatchTrace from '@/components/quality/MobileBatchTrace';
import React,{useEffect,useState} from 'react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {ui,uiMessage} from '@/lib/i18n';
import {formatQuantity,formatAccountingXAF,formatDate} from '@/lib/formatters';
import {Link} from '@/lib/router';

export default function AssemblyBuildDetails({order}){
  const phone=usePhoneLayout(),navigate=useNavigate();
  const [trace,setTrace]=useState(null);
  useEffect(()=>{if(!phone||!order.batch_number||!order.product_id)return;let active=true;traceBatch(order.batch_number,order.product_id).then(data=>{if(active)setTrace(data);}).catch(()=>{});return()=>{active=false;};},[phone,order.batch_number,order.product_id]);
  const [materials,setMaterials]=useState([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;readAll(erp.entities.ProductionMaterial,{production_order_id:order.id}).then(rows=>{if(active)setMaterials(rows);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[order.id]);
  const content=<section className="space-y-4 rounded-xl border bg-white p-4 sm:p-6"><h1 className="text-xl font-semibold">{ui('Assembly build')} · {order.order_number}</h1><p className="text-green-800">{ui('Finished products released for sale')}</p>
    <p className="font-medium">{order.product_name} · {formatQuantity(order.actual_output)}</p><dl className="grid gap-3 text-sm sm:grid-cols-2">
      {[[ui('Build date'),formatDate(order.production_date)],[ui('Batch'),order.batch_number],[ui('Expiry'),formatDate(order.expiry_date)],[ui('Finished stock location'),order.output_warehouse_name],[ui('Carrying value'),formatAccountingXAF(order.total_material_cost)]].map(([label,value])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="overflow-auto"><table className="mobile-table-cards w-full text-left text-sm"><thead><tr>{['Component','Quantity consumed','Carrying value'].map(h=><th className="p-2" key={h}>{ui(h)}</th>)}</tr></thead><tbody>{materials.map(m=><tr key={m.id} className="border-t"><th className="p-2 font-medium">{m.material_name}</th><td className="p-2">{formatQuantity(m.consumed_quantity)} {m.unit}</td><td className="p-2">{formatAccountingXAF(m.total_cost)}</td></tr>)}</tbody></table></div>
    <div className="flex flex-wrap gap-4 text-sm"><Link className="underline" to={'/traceability?batch='+encodeURIComponent(order.batch_number||'')+'&product='+encodeURIComponent(order.product_id||'')}>{ui('Trace batch')}</Link><Link className="underline" to="/manufacturing?section=build">{ui('Build assemblies')}</Link><Link className="underline" to="/inventory">{ui('Open inventory')}</Link></div>
  </section>;
  if(phone&&trace)return <MobileBatchTrace data={trace} lot={trace.lot||{lot_number:order.batch_number,product_name:order.product_name,expiry_date:order.expiry_date,unit:order.output_unit||'units'}} onBack={()=>navigate('/manufacturing?section=build')}>{content}</MobileBatchTrace>;
  return content;
}
