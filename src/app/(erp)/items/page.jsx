import { redirect } from 'next/navigation';
import { inventoryPathForSearch } from '@/lib/inventory-navigation';

export default async function Page({ searchParams }) {
  redirect(inventoryPathForSearch(await searchParams));
}
