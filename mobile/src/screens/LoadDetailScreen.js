import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import api from '../services/api';
import { startBackgroundTracking, stopBackgroundTracking, isTracking } from '../services/tracking';
import { COLORS } from '../constants/config';

const STATUS_COLORS = {
  open: COLORS.info,
  accepted: '#a78bfa',
  'in-transit': COLORS.warning,
  delivered: COLORS.success,
};

export default function LoadDetailScreen({ route, navigation }) {
  const [load, setLoad] = useState(route.params.load);
  const [tracking, setTracking] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    // Check if we're currently tracking this load
    (async () => {
      const running = await isTracking();
      setTracking(running);
    })();
  }, []);

  const refreshLoad = async () => {
    try {
      const { data } = await api.get(`/loads/${load._id}`);
      setLoad(data);
    } catch { /* ignore */ }
  };

  // ── Accept load ────────────────────────────────────────────────
  const handleAccept = async () => {
    setActionLoading(true);
    try {
      await api.put(`/loads/${load._id}/accept`);
      Alert.alert('Success', 'Load accepted!');
      await refreshLoad();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not accept');
    }
    setActionLoading(false);
  };

  // ── Start trip (dispatch) — starts background tracking ─────────
  const handleStartTrip = async () => {
    setActionLoading(true);
    try {
      // Transition accepted → in-transit
      await api.put(`/loads/${load._id}/status`, { status: 'in-transit' });
      // Start background GPS tracking
      await startBackgroundTracking(load._id);
      setTracking(true);
      Alert.alert('Trip Started', 'GPS tracking is now active. You can lock your phone — tracking continues in the background.');
      await refreshLoad();
    } catch (err) {
      // Privacy gate: route the carrier to grant GPS consent, then retry.
      if (err.code === 'gps_consent_required' || err.response?.data?.code === 'gps_consent_required') {
        Alert.alert(
          'GPS Consent Needed',
          'Before tracking can start, please review and grant GPS tracking consent.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Review', onPress: () => navigation.navigate('Consent') },
          ]
        );
      } else {
        Alert.alert('Error', err.response?.data?.error || err.message || 'Could not start trip');
      }
    }
    setActionLoading(false);
  };

  // ── Complete delivery — stops tracking ─────────────────────────
  const handleDeliver = async () => {
    Alert.alert('Confirm Delivery', 'Mark this load as delivered?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setActionLoading(true);
          try {
            await api.put(`/loads/${load._id}/status`, { status: 'delivered' });
            await stopBackgroundTracking();
            setTracking(false);
            Alert.alert('Delivered', 'Load marked as delivered. GPS tracking stopped.');
            await refreshLoad();
            navigation.navigate('Loads');
          } catch (err) {
            Alert.alert('Error', err.response?.data?.error || 'Could not mark delivered');
          }
          setActionLoading(false);
        },
      },
    ]);
  };

  // ── Stop tracking without delivering ───────────────────────────
  const handleStopTracking = async () => {
    await stopBackgroundTracking();
    setTracking(false);
    Alert.alert('Tracking Stopped', 'GPS tracking has been paused.');
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'TBD';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status badge */}
      <View style={styles.statusRow}>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[load.status] || COLORS.textMuted }]}>
          <Text style={styles.badgeText}>{load.status}</Text>
        </View>
        {tracking && (
          <View style={[styles.badge, { backgroundColor: COLORS.success }]}>
            <Text style={styles.badgeText}>GPS ACTIVE</Text>
          </View>
        )}
      </View>

      <Text style={styles.title}>{load.title}</Text>
      <Text style={styles.route}>{load.origin} → {load.destination}</Text>

      {/* Details card */}
      <View style={styles.card}>
        <Row label="Rate" value={`$${load.rate?.toLocaleString()}`} />
        <Row label="Equipment" value={load.equipmentType} />
        {load.loadWeight && <Row label="Weight" value={`${load.loadWeight.toLocaleString()} lbs`} />}
        {load.commodityType && <Row label="Commodity" value={load.commodityType} />}
        <Row label="Pickup" value={fmt(load.pickupTimeWindow?.start)} />
        <Row label="Delivery" value={fmt(load.deliveryTimeWindow?.start)} />
      </View>

      {/* Pickup / Delivery details */}
      {(load.pickupFacilityName || load.deliveryFacilityName) && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Facility Info</Text>
          {load.pickupFacilityName && (
            <>
              <Text style={styles.facilityLabel}>Pickup</Text>
              <Text style={styles.facilityValue}>{load.pickupFacilityName}</Text>
              {load.pickupAddress && <Text style={styles.facilityAddr}>{load.pickupAddress}</Text>}
              {load.pickupContactName && <Text style={styles.facilityAddr}>Contact: {load.pickupContactName} {load.pickupContactPhone}</Text>}
            </>
          )}
          {load.deliveryFacilityName && (
            <>
              <Text style={[styles.facilityLabel, { marginTop: 10 }]}>Delivery</Text>
              <Text style={styles.facilityValue}>{load.deliveryFacilityName}</Text>
              {load.deliveryAddress && <Text style={styles.facilityAddr}>{load.deliveryAddress}</Text>}
              {load.deliveryContactName && <Text style={styles.facilityAddr}>Contact: {load.deliveryContactName} {load.deliveryContactPhone}</Text>}
            </>
          )}
        </View>
      )}

      {/* Special instructions */}
      {load.specialInstructions && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Text style={styles.instructions}>{load.specialInstructions}</Text>
        </View>
      )}

      {/* View on Map */}
      <TouchableOpacity
        style={styles.mapBtn}
        onPress={() => navigation.navigate('LoadMap', { load })}
      >
        <Text style={styles.mapBtnText}>View on Map</Text>
      </TouchableOpacity>

      {/* Action buttons */}
      <View style={styles.actions}>
        {actionLoading && <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 12 }} />}

        {load.status === 'open' && (
          <ActionButton label="Accept Load" color={COLORS.success} onPress={handleAccept} disabled={actionLoading} />
        )}

        {load.status === 'accepted' && !tracking && (
          <ActionButton label="Start Trip (Begin Tracking)" color={COLORS.warning} onPress={handleStartTrip} disabled={actionLoading} />
        )}

        {load.status === 'in-transit' && !tracking && (
          <ActionButton label="Resume Tracking" color={COLORS.warning} onPress={() => startBackgroundTracking(load._id).then(() => setTracking(true))} disabled={actionLoading} />
        )}

        {tracking && (
          <ActionButton label="Stop Tracking" color={COLORS.textMuted} onPress={handleStopTracking} disabled={actionLoading} />
        )}

        {load.status === 'in-transit' && (
          <ActionButton label="Mark Delivered" color={COLORS.success} onPress={handleDeliver} disabled={actionLoading} />
        )}

        {['accepted', 'in-transit'].includes(load.status) && (
          <ActionButton
            label="Upload POD"
            color={COLORS.indigo}
            onPress={() => navigation.navigate('PODUpload', { loadId: load._id })}
            disabled={actionLoading}
          />
        )}
      </View>
    </ScrollView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ActionButton({ label, color, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: color }, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 100 },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#000', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  route: { color: COLORS.indigo, fontSize: 16, fontWeight: '600', marginBottom: 16 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: COLORS.textMuted, fontSize: 14 },
  rowValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  facilityLabel: { color: COLORS.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  facilityValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  facilityAddr: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  instructions: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20 },
  mapBtn: {
    backgroundColor: '#1a2744',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 199, 183, 0.3)',
  },
  mapBtnText: { color: '#00C7B7', fontSize: 15, fontWeight: '700' },
  actions: { marginTop: 8 },
  actionBtn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  actionBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
