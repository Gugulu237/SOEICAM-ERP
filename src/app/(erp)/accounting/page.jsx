'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/Accounting'), { ssr: false });
export default function Page() { return <Screen />; }
