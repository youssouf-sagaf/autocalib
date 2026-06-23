import { createContext, useContext, type ReactNode } from 'react';

const WorkspaceLayoutContext = createContext(0);

export function WorkspaceLayoutProvider({
  layoutVersion,
  children,
}: {
  layoutVersion: number;
  children: ReactNode;
}) {
  return (
    <WorkspaceLayoutContext.Provider value={layoutVersion}>
      {children}
    </WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayoutVersion(): number {
  return useContext(WorkspaceLayoutContext);
}
