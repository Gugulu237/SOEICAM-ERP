'use client';
import {Navigate,useSearchParams} from '@/lib/router';
import {useCurrentUser} from '@/hooks/useCurrentUser';
export default function SalesReports(){const {role}=useCurrentUser(),[params]=useSearchParams();return <Navigate to={role==='admin'&&params.get('section')==='commercial'?'/team-workspaces?section=reports&role=commercial':'/sales'} replace/>;}
