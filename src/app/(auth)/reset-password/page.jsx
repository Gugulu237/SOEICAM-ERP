'use client';
import dynamic from 'next/dynamic';
import { usesClerk } from '@/lib/auth-provider';
import { Navigate } from '@/lib/router';
const Screen = dynamic(() => import('@/views/ResetPassword'), { ssr: false });
export default function Page() { return usesClerk() ? <Navigate to="/login" replace /> : <Screen />; }
