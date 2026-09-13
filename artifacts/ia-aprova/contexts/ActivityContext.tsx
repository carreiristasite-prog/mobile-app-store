import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Activity = { id: string; type: 'question' | 'simulation' | 'achievement'; title: string; createdAt: string };
type ActivityContextValue = { activities: Activity[]; recordActivity: (activity: Omit<Activity, 'id' | 'createdAt'>) => void; clearActivities: () => void };
const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: React.PropsWithChildren) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const recordActivity = useCallback((activity: Omit<Activity, 'id' | 'createdAt'>) => {
    setActivities((current) => [{ ...activity, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString() }, ...current].slice(0, 50));
  }, []);
  const clearActivities = useCallback(() => setActivities([]), []);
  const value = useMemo(() => ({ activities, recordActivity, clearActivities }), [activities, recordActivity, clearActivities]);
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('useActivity deve ser usado dentro de ActivityProvider.');
  return value;
}
