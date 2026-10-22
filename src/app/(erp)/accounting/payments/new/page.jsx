'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/PaymentForm'), { ssr: false });
export default function Page() { return <Screen />; }
