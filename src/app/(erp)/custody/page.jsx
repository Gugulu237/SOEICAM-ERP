import {redirect} from 'next/navigation';
import {distributionPath} from '@/lib/distribution-navigation';
export default async function Page({searchParams}){redirect(distributionPath('stock',await searchParams));}
