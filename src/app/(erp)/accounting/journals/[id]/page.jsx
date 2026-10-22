'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/JournalDetail'), { ssr: false });
export default function Page() { return <Screen />; }
