'use client';
import dynamic from 'next/dynamic';
const Screen=dynamic(()=>import('@/views/RecurringExpenses'),{ssr:false});
export default function Page(){return <Screen/>;}
