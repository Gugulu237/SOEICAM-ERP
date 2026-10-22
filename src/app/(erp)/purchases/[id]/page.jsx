import { redirect } from 'next/navigation';
import { purchasePath } from '@/lib/purchase-workspace';
export default async function Page({params}) { redirect(purchasePath({order:(await params).id})); }
