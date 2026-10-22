'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@/views/EmployeeDashboard'), { ssr: false });
export default function TeamWorkspaceScreen() { return <Screen />; }
