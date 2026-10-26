'use client';
import {ui} from '@/lib/i18n';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/JournalDetail'), { ssr: false, loading:()=> <p role="status">{ui("Loading journal...")}</p> });
export default function Page() { return <Screen />; }
