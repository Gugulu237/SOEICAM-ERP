'use client';
import dynamic from 'next/dynamic';
import {Link} from '@/lib/router';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useCurrentUser} from '@/hooks/useCurrentUser';
const Returns=dynamic(()=>import('@/components/distribution/UnsoldStockReturns'),{ssr:false});
export default function Page(){useLocaleRender();const {role}=useCurrentUser();return <main className="space-y-4"><Link className="text-sm text-slate-600 underline" to={role==='driver'?'/distribution?tab=stock':'/my-stock'}>{ui('My issued stock')}</Link><Returns/></main>;}
