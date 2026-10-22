import {redirect} from 'next/navigation';
import {qualityPath} from '@/lib/quality-workspace';
export default async function Page({searchParams}){const params=await searchParams;redirect(qualityPath(params.section || (params.batch?'traceability':'release'),params));}
