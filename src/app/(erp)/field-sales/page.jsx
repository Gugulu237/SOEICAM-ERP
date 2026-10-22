'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/FieldSales'), { ssr: false });
export default function Page() { return <Screen />; }
