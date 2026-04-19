import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const KEYS = {
  CACHED_LOADS: 'cached_loads',
  CACHED_LOADS_AT: 'cached_loads_at',
  ACTION_QUEUE: 'action_queue',
};

class OfflineStore {
  // ── Cache loads for offline viewing ──────────────────────────────
  async cacheLoads(loads) {
    try {
      await AsyncStorage.setItem(KEYS.CACHED_LOADS, JSON.stringify(loads));
      await AsyncStorage.setItem(KEYS.CACHED_LOADS_AT, new Date().toISOString());
    } catch (err) {
      console.error('[OfflineStore] cacheLoads failed:', err.message);
    }
  }

  async getCachedLoads() {
    try {
      const raw = await AsyncStorage.getItem(KEYS.CACHED_LOADS);
      if (!raw) return null;
      const cachedAt = await AsyncStorage.getItem(KEYS.CACHED_LOADS_AT);
      return {
        loads: JSON.parse(raw),
        cachedAt: cachedAt || null,
      };
    } catch (err) {
      console.error('[OfflineStore] getCachedLoads failed:', err.message);
      return null;
    }
  }

  // ── Queue actions for when back online ───────────────────────────
  async queueAction(action) {
    try {
      const raw = await AsyncStorage.getItem(KEYS.ACTION_QUEUE);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({
        ...action,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        queuedAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem(KEYS.ACTION_QUEUE, JSON.stringify(queue));
    } catch (err) {
      console.error('[OfflineStore] queueAction failed:', err.message);
    }
  }

  async getQueuedActions() {
    try {
      const raw = await AsyncStorage.getItem(KEYS.ACTION_QUEUE);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async processQueue(apiInstance) {
    const raw = await AsyncStorage.getItem(KEYS.ACTION_QUEUE);
    const queue = raw ? JSON.parse(raw) : [];
    if (queue.length === 0) return [];

    const results = [];

    for (const action of queue) {
      try {
        switch (action.type) {
          case 'accept_load':
            await apiInstance.put(`/loads/${action.payload.loadId}/accept`);
            results.push({ success: true, action });
            break;

          case 'update_status':
            await apiInstance.put(
              `/loads/${action.payload.loadId}/status`,
              { status: action.payload.status }
            );
            results.push({ success: true, action });
            break;

          case 'upload_pod': {
            const formData = new FormData();
            formData.append('pod', {
              uri: action.payload.uri,
              name: action.payload.filename || 'pod.jpg',
              type: action.payload.type || 'image/jpeg',
            });
            if (action.payload.signatureData) {
              formData.append('signatureData', action.payload.signatureData);
            }
            if (action.payload.signerName) {
              formData.append('signerName', action.payload.signerName);
            }
            await apiInstance.post(
              `/documents/pod/${action.payload.loadId}`,
              formData,
              { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            results.push({ success: true, action });
            break;
          }

          default:
            results.push({ success: false, action, error: `Unknown action type: ${action.type}` });
        }
      } catch (err) {
        results.push({ success: false, action, error: err.message });
      }
    }

    // Keep only failed actions in queue
    const failed = results.filter((r) => !r.success).map((r) => r.action);
    await AsyncStorage.setItem(KEYS.ACTION_QUEUE, JSON.stringify(failed));

    return results;
  }

  // ── Monitor connectivity ─────────────────────────────────────────
  subscribeToConnectivity(onOnline, onOffline) {
    return NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        onOnline();
      } else {
        onOffline();
      }
    });
  }

  // ── Check current connectivity ───────────────────────────────────
  async isOnline() {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected;
    } catch {
      return false;
    }
  }

  // ── Clear all cached data ────────────────────────────────────────
  async clearCache() {
    try {
      await AsyncStorage.multiRemove([KEYS.CACHED_LOADS, KEYS.CACHED_LOADS_AT]);
    } catch (err) {
      console.error('[OfflineStore] clearCache failed:', err.message);
    }
  }
}

export default new OfflineStore();
