"use client";

import { createContext, useContext, useState } from "react";

type ResearchModeContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const ResearchModeContext = createContext<ResearchModeContextValue | null>(null);

export function ResearchModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(true);

  return (
    <ResearchModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </ResearchModeContext.Provider>
  );
}

export function useResearchMode() {
  const context = useContext(ResearchModeContext);
  if (!context) {
    throw new Error("useResearchMode must be used within ResearchModeProvider");
  }
  return context;
}
