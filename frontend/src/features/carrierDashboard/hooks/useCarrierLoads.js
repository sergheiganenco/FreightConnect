// =========================================================
// src/features/carrierDashboard/hooks/useLoads.js
// (React-Query wrapper + cache-update helper)
// =========================================================
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../../services/api';   // ← keep your relative path

export function useCarrierLoads() {
  const [filters, setFilters] = useState({ status: 'open' });
  const token = localStorage.getItem('token');
  const queryClient = useQueryClient();

  /* ---------- query key + fetcher -------------------------------- */
  const queryKey = ['loads', filters];

  const queryFn = async () => {
    const { data } = await api.get('/loads', {
      headers: { Authorization: `Bearer ${token}` },
      params: filters,
    });
    return data;
  };

  const {
    data: loads = [],
    isLoading,
    error,
  } = useQuery({ queryKey, queryFn });

  /* ---------- helper: mutate the cached list --------------------- */
  const setLoads = (updater) => {
    queryClient.setQueryData(queryKey, (prev) =>
      typeof updater === 'function' ? updater(prev ?? []) : updater
    );
  };

  return {
    loads,
    setLoads,          // <- expose setter
    isLoading,
    error: error?.message,
    filters,
    setFilters,
  };
}
