'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/DispatchRequestForm'), { ssr: false });
export default function Page() { return <Screen />; }
