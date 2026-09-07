import { createContext, useContext } from "react";
import { useWorkspace } from "./useWorkspace.js";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const workspace = useWorkspace();
  return (
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("WorkspaceProvider is required");
  return workspace;
}
