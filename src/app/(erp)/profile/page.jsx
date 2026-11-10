'use client';
import dynamic from 'next/dynamic';
import {useSearchParams} from '@/lib/router';
const Profile=dynamic(()=>import('@/views/MyProfile'),{ssr:false});
const More=dynamic(()=>import('@/views/MoreWorkspace'),{ssr:false});
export default function Page(){const [params]=useSearchParams();return params.get('section')==='more'?<More/>:<Profile/>;}
