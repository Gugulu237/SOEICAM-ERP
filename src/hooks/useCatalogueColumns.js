import {useSyncExternalStore} from 'react';

const subscribe = callback => {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
};
const snapshot = () => window.matchMedia('(min-width: 1280px)').matches ? 5 : window.matchMedia('(min-width: 1024px)').matches ? 4 : window.matchMedia('(min-width: 640px)').matches ? 3 : 2;
// Match the catalogue's CSS breakpoints, including the local preview iframe.
export function useCatalogueColumns(table) {
  const columns = useSyncExternalStore(subscribe, snapshot, () => 2);
  return table ? 1 : columns;
}
