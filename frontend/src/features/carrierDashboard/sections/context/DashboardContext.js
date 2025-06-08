import { createContext, useContext, useState } from 'react';

export const DashboardContext = createContext();
export const useDashboard     = () => useContext(DashboardContext);

export function DashboardProvider({ children }) {
  const [loads,          setLoads]          = useState([]);
  const [snackbar,       setSnackbar]       = useState({ open: false, msg: '' });
  const [activeLoadId,   setActiveLoadId]   = useState(null);

  return (
    <DashboardContext.Provider
      value={{ loads, setLoads, snackbar, setSnackbar, activeLoadId, setActiveLoadId }}
    >
      {children}
    </DashboardContext.Provider>
  );
}
