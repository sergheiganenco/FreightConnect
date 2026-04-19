import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import api from '../services/api';
import { COLORS } from '../constants/config';
import offlineStore from '../services/offlineStore';

const STATUS_COLORS = {
  open: COLORS.info,
  accepted: '#a78bfa',
  'in-transit': COLORS.warning,
  delivered: COLORS.success,
  cancelled: COLORS.textMuted,
};

export default function LoadBoardScreen() {
  const navigation = useNavigation();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('available'); // available | my
  const [isOffline, setIsOffline] = useState(false);

  const fetchLoads = useCallback(async () => {
    try {
      let fetchedLoads;
      if (tab === 'available') {
        const { data } = await api.get('/loads?status=open');
        fetchedLoads = data.loads || data || [];
      } else {
        const { data } = await api.get('/loads?role=carrier');
        fetchedLoads = data.loads || data || [];
      }
      setLoads(fetchedLoads);
      setIsOffline(false);
      // Cache loads for offline use
      offlineStore.cacheLoads(fetchedLoads);
    } catch (err) {
      console.error('Load fetch error:', err.message);
      // Fallback to cached loads on network failure
      const cached = await offlineStore.getCachedLoads();
      if (cached && cached.loads) {
        setLoads(cached.loads);
        setIsOffline(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    fetchLoads();
  }, [fetchLoads]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLoads();
  };

  const acceptLoad = async (loadId) => {
    try {
      await api.put(`/loads/${loadId}/accept`);
      Alert.alert('Success', 'Load accepted!');
      fetchLoads();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not accept load');
    }
  };

  const renderLoad = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('LoadDetail', { load: item })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] || COLORS.textMuted }]}>
          <Text style={styles.badgeText}>{item.status}</Text>
        </View>
      </View>

      <Text style={styles.route}>
        {item.origin} → {item.destination}
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Rate</Text>
        <Text style={styles.value}>${item.rate?.toLocaleString()}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Equipment</Text>
        <Text style={styles.value}>{item.equipmentType}</Text>
      </View>

      {item.loadWeight && (
        <View style={styles.row}>
          <Text style={styles.label}>Weight</Text>
          <Text style={styles.value}>{item.loadWeight.toLocaleString()} lbs</Text>
        </View>
      )}

      {tab === 'available' && item.status === 'open' && (
        <TouchableOpacity
          style={styles.acceptBtn}
          onPress={() => {
            Alert.alert('Accept Load', `Accept "${item.title}" at $${item.rate}?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Accept', onPress: () => acceptLoad(item._id) },
            ]);
          }}
        >
          <Text style={styles.acceptBtnText}>Accept Load</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Tab switcher */}
      <View style={styles.tabs}>
        {['available', 'my'].map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'available' ? 'Available Loads' : 'My Loads'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Offline banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Offline - Showing cached data</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={loads}
          keyExtractor={(item) => item._id}
          renderItem={renderLoad}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'available' ? 'No loads available right now.' : 'No loads assigned to you yet.'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: COLORS.bgCard,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#fff' },
  offlineBanner: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#000', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  route: { color: COLORS.indigo, fontSize: 14, fontWeight: '600', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: COLORS.textMuted, fontSize: 13 },
  value: { color: '#fff', fontSize: 13, fontWeight: '600' },
  acceptBtn: {
    backgroundColor: COLORS.success,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  acceptBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, fontSize: 15 },
});
