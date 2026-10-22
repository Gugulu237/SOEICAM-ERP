
import { useSyncExternalStore } from 'react';
import { toastStore } from '@/lib/toast-store';
export const toast = toastStore.toast;
export function useToast() {
  const state = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getServerSnapshot);
  return { ...state, toast, dismiss: toastStore.dismiss };
}
