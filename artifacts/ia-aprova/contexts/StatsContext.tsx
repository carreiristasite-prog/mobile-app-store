import React, { createContext, useContext, useMemo, useState } from 'react';

export type StudyStats = { answered: number; correct: number; streak: number; xp: number };
const initialStats: StudyStats = { answered: 0, correct: 0, streak: 0, xp: 0 };
const StatsContext = createContext<{ stats: StudyStats; setStats: React.Dispatch<React.SetStateAction<StudyStats>> } | null>(null);

export function StatsProvider({ children }: React.PropsWithChildren) {
  const [stats, setStats] = useState(initialStats);
  const value = useMemo(() => ({ stats, setStats }), [stats]);
  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats() {
  const value = useContext(StatsContext);
  if (!value) throw new Error('useStats deve ser usado dentro de StatsProvider.');
  return value;
}
