import { redirect } from 'next/navigation';
import { purchasePath } from '@/lib/purchase-workspace';
export default function Page() { redirect(purchasePath({compose:'order'})); }
