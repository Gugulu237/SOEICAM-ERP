import React, { createContext, useContext } from 'react';
import { moduleForPath } from '@/server/domain/role-catalogue';
const Access = createContext(null);
export function WorkspaceAccess({ modules, children }) {
  return <Access.Provider value={modules ?? null}>{children}</Access.Provider>;
}
export function useWorkspaceAccess() {
  const modules = useContext(Access);
  return { modules, can: module => !modules || modules.includes(module), canOpen: path => !modules || !moduleForPath(path) || modules.includes(moduleForPath(path)) };
}
