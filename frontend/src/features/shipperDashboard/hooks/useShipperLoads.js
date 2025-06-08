import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../../services/api';

export function useShipperLoads() {
  const [filters, setFilters] = useState({});
  const token = localStorage.getItem('token');
  const queryClient = useQueryClient();

  const queryKey = ['loads', filters];

  const queryFn = async () => {
    // 👇👇 THIS IS THE CORRECT ENDPOINT
    const { data } = await api.get('/loads/posted', {
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

  const setLoads = (updater) => {
    queryClient.setQueryData(queryKey, (prev) =>
      typeof updater === 'function' ? updater(prev ?? []) : updater
    );
  };

  return {
    loads,
    setLoads,
    isLoading,
    error: error?.message,
    filters,
    setFilters,
  };
}
