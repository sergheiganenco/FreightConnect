import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Snackbar, Alert, Slide } from '@mui/material';
import { WifiOff, Wifi } from '@mui/icons-material';

const FAILED_REQUESTS_KEY = 'fc_offline_queue';

function SlideTransition(props) {
  return <Slide {...props} direction="down" />;
}

/**
 * Queues a failed API request for retry when back online.
 * Call this from your Axios interceptor on network errors.
 */
export function queueFailedRequest(config) {
  if (!config || !config.url || !config.method) return;
  try {
    const queue = JSON.parse(localStorage.getItem(FAILED_REQUESTS_KEY) || '[]');
    queue.push({
      url: config.url,
      method: config.method,
      data: config.data || null,
      timestamp: Date.now(),
    });
    // Keep max 50 queued requests
    if (queue.length > 50) queue.shift();
    localStorage.setItem(FAILED_REQUESTS_KEY, JSON.stringify(queue));
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Retries queued requests. Returns count of retried items.
 */
async function retryQueuedRequests(apiInstance) {
  try {
    const raw = localStorage.getItem(FAILED_REQUESTS_KEY);
    if (!raw) return 0;
    const queue = JSON.parse(raw);
    if (!queue.length) return 0;

    localStorage.removeItem(FAILED_REQUESTS_KEY);

    let retried = 0;
    for (const req of queue) {
      // Skip requests older than 1 hour
      if (Date.now() - req.timestamp > 3600000) continue;
      try {
        await apiInstance({ method: req.method, url: req.url, data: req.data });
        retried++;
      } catch {
        // Re-queue if still failing
        queueFailedRequest(req);
      }
    }
    return retried;
  } catch {
    return 0;
  }
}

export default function OfflineDetector({ apiInstance }) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showOnlineToast, setShowOnlineToast] = useState(false);
  const wasOfflineRef = useRef(false);

  const handleOffline = useCallback(() => {
    setIsOffline(true);
    wasOfflineRef.current = true;
  }, []);

  const handleOnline = useCallback(async () => {
    setIsOffline(false);
    if (wasOfflineRef.current) {
      setShowOnlineToast(true);
      wasOfflineRef.current = false;

      // Retry queued requests if api instance provided
      if (apiInstance) {
        await retryQueuedRequests(apiInstance);
      }
    }
  }, [apiInstance]);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return (
    <>
      {/* Persistent offline banner */}
      <Snackbar
        open={isOffline}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        TransitionComponent={SlideTransition}
        sx={{ top: '0 !important' }}
      >
        <Alert
          severity="warning"
          icon={<WifiOff />}
          sx={{
            width: '100%',
            borderRadius: 0,
            background: 'rgba(251,191,36,0.95)',
            color: '#0f172a',
            fontWeight: 600,
            '& .MuiAlert-icon': { color: '#0f172a' },
          }}
        >
          You're offline. Changes will sync when reconnected.
        </Alert>
      </Snackbar>

      {/* Back online toast */}
      <Snackbar
        open={showOnlineToast}
        autoHideDuration={3000}
        onClose={() => setShowOnlineToast(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        TransitionComponent={SlideTransition}
      >
        <Alert
          severity="success"
          icon={<Wifi />}
          onClose={() => setShowOnlineToast(false)}
          sx={{
            background: 'rgba(52,211,153,0.95)',
            color: '#0f172a',
            fontWeight: 600,
            '& .MuiAlert-icon': { color: '#0f172a' },
          }}
        >
          Back online!
        </Alert>
      </Snackbar>
    </>
  );
}
