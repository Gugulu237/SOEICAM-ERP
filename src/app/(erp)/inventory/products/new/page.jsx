'use client';
import dynamic from 'next/dynamic';
import PageLoading from '@/components/shared/PageLoading';
const Screen = dynamic(() => import('@/views/ItemForm'), { ssr: false, loading: () => <PageLoading /> });
export default function Page() { return <Screen />; }
