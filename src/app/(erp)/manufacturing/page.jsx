'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/Manufacturing'), { ssr: false });
export default function Page() { return <Screen />; }
