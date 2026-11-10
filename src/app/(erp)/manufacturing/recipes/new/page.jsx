import {redirect} from 'next/navigation';
import {assemblyCataloguePath} from '@/lib/manufacturing-workspace';

export default async function Page({searchParams}){
  redirect(assemblyCataloguePath(await searchParams));
}
