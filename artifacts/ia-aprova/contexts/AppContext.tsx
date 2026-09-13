import React, { createContext, useContext, useMemo, useState } from 'react';

type AppContextValue = {
  selectedContestId: string | null;
  setSelectedContestId: (contestId: string | null) => void;
  onboardingComplete: boolean;
  setOnboardingComplete: (complete: boolean) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: React.PropsWithChildren) {
  const [selectedContestId, setSelectedContestId] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const value = useMemo(() => ({ selectedContestId, setSelectedContestId, onboardingComplete, setOnboardingComplete }), [selectedContestId, onboardingComplete]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp deve ser usado dentro de AppProvider.');
  return value;
}
