import {redirect} from 'next/navigation';
import {assemblyBuildPath} from '@/lib/manufacturing-workspace';

export default async function Page({searchParams}){
  redirect(assemblyBuildPath(await searchParams));
}
