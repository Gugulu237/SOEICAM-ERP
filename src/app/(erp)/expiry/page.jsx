import {redirect} from 'next/navigation';
import {qualityPath} from '@/lib/quality-workspace';
export default async function Page({searchParams}){redirect(qualityPath('expiry',await searchParams));}
