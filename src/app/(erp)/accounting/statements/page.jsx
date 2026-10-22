'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/FinancialStatements'), { ssr: false });
export default function Page() { return <Screen />; }
