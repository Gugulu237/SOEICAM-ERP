'use client';
import React,{useMemo} from 'react';
import dynamic from 'next/dynamic';
import {ui} from '@/lib/i18n';
import {deliveryGpsStatus} from '@/lib/customer-delivery';
const GeoMap=dynamic(()=>import('./CustomerGeoMap'),{ssr:false,loading:()=> <p role="status" className="py-10 text-xs">{ui('Loading map...')}</p>});
const frame={kind:'points'};
export default function GoogleCustomerMap({customers,onSelect,...mapProps}){
  const points=useMemo(()=>customers.map(p=>({...p,gps_status:p.gps_status||deliveryGpsStatus(p)})),[customers]);
  return <GeoMap points={points} onSelect={onSelect} frame={frame} {...mapProps}/>;
}
