'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/Inventory'), { ssr: false });
export default function Page() { return <Screen />; }
