'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/Purchases'), { ssr: false });
export default function Page() { return <Screen />; }
