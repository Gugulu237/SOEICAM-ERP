'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/Sales'), { ssr: false });
export default function Page() { return <Screen />; }
