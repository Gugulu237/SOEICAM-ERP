'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/RecipeForm'), { ssr: false });
export default function Page() { return <Screen />; }
