'use client';
import dynamic from 'next/dynamic';
import { usesClerk } from '@/lib/auth-provider';
import ClerkAuthScreen from '@/components/ClerkAuthScreen';
const Screen = dynamic(() => import('@/views/Register'), { ssr: false });
export default function Page() { return usesClerk() ? <ClerkAuthScreen signUp /> : <Screen />; }
