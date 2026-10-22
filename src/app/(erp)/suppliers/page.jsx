import { redirect } from 'next/navigation';
import { legacySupplierPath } from '@/lib/purchase-workspace';
export default async function Page({searchParams}) { redirect(legacySupplierPath(await searchParams)); }
