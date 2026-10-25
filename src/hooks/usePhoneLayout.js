import { useSyncExternalStore } from 'react';

const query = '(max-width: 639px)';
const subscribe = callback => {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
};
const snapshot = () => window.matchMedia(query).matches;
export function usePhoneLayout() { return useSyncExternalStore(subscribe, snapshot, () => false); }
