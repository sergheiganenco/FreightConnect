import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import TosAcceptanceModal from './TosAcceptanceModal';

/**
 * Wraps the app and intercepts 403 responses with tosRequired: true.
 * When detected, shows the ToS acceptance modal that blocks interaction
 * until the user accepts the current Terms of Service.
 */
export default function TosGuardProvider({ children }) {
  const [showTos, setShowTos] = useState(false);

  useEffect(() => {
    // Add a response interceptor that catches ToS-required responses
    const interceptorId = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (
          error.response?.status === 403 &&
          error.response?.data?.tosRequired === true
        ) {
          setShowTos(true);
          // Don't reject — suppress the error so the UI doesn't flash errors
          // The modal will block interaction until ToS is accepted
          return new Promise(() => {}); // hang the promise — modal handles flow
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(interceptorId);
    };
  }, []);

  const handleAccepted = useCallback(() => {
    setShowTos(false);
    // Reload the page to retry all blocked requests with fresh ToS status
    window.location.reload();
  }, []);

  return (
    <>
      {children}
      <TosAcceptanceModal open={showTos} onAccepted={handleAccepted} />
    </>
  );
}
