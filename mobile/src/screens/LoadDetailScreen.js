import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import api from '../services/api';
import { startBackgroundTracking, stopBackgroundTracking, isTracking } from '../services/tracking';
import { COLORS } from '../constants/config';

const STATUS_COLORS = {
  open: COLORS.info,
  accepted: '#a78bfa',
  'in-transit': COLORS.warning,
  delivered: COLORS.success,
};

const fmtFull = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'TBD');

export default function LoadDetailScreen({ route, navigation }) {
  const [load, setLoad] = useState(route.params.load);
  const [tracking, setTracking] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pickup, setPickup] = useState(null); // { code } | { verifiedAt } — pickup handshake
  const [pendingAsk, setPendingAsk] = useState(false); // the system is asking for a check-call answer

  // Photo evidence (pickup / delivery). Server stores who/when/where + a fingerprint; photos are immutable.
  const addPhoto = (stage) => {
    Alert.alert(`${stage === 'pickup' ? 'Pickup' : 'Delivery'} photo`, 'What are you photographing?', [
      { text: 'Freight', onPress: () => takeEvidence(stage, 'cargo') },
      { text: 'Seal', onPress: () => takeEvidence(stage, 'seal') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const takeEvidence = async (stage, kind) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permission Required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setActionLoading(true);
    try {
      const fd = new FormData();
      fd.append('stage', stage);
      fd.append('kind', kind);
      // GPS only if location permission was already granted (no new prompt here).
      let located = false;
      try {
        const lp = await Location.getForegroundPermissionsAsync();
        if (lp.granted) {
          const pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
          ]);
          fd.append('latitude', String(pos.coords.latitude));
          fd.append('longitude', String(pos.coords.longitude));
          if (pos.coords.accuracy != null) fd.append('accuracyMeters', String(pos.coords.accuracy));
          located = true;
        }
      } catch (_) { /* proceed without location */ }
      fd.append('capturedAt', new Date().toISOString());
      fd.append('file', { uri: result.assets[0].uri, name: `evidence_${stage}.jpg`, type: 'image/jpeg' });
      await api.post(`/loads/${load._id}/evidence`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      Alert.alert('Photo saved', located ? 'Photo added to the load record.' : 'Photo added, marked "location not provided".');
    } catch (err) {
      Alert.alert('Upload Failed', err.response?.data?.error || 'Could not upload photo');
    }
    setActionLoading(false);
  };

  // Pickup handshake: the booked carrier's account is the only place the dock code is shown.
  useEffect(() => {
    if (load.status !== 'accepted') { setPickup(load.pickupVerification?.verifiedAt ? { verifiedAt: load.pickupVerification.verifiedAt } : null); return; }
    api.get(`/loads/${load._id}/pickup-code`)
      .then(({ data }) => setPickup(data.verified ? { verifiedAt: data.verifiedAt } : { code: data.code }))
      .catch(() => setPickup(null));
  }, [load._id, load.status]);

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

  // Automatic check calls: the server asks when it cannot see a position; one tap tells the shipper how it is going.
  const booked = ['accepted', 'in-transit'].includes(load.status);
  useEffect(() => {
    if (!booked) return;
    api.get(`/loads/${load._id}/check-calls`).then(({ data }) => setPendingAsk(!!data.pendingAsk)).catch(() => {});
  }, [load._id, booked]);
  const sendCheckCall = async (body) => {
    setActionLoading(true);
    try {
      await api.post(`/loads/${load._id}/check-call`, body);
      setPendingAsk(false);
      Alert.alert('Sent', 'The shipper can see your update.');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not send your update');
    }
    setActionLoading(false);
  };
  const askDelay = () => {
    const opts = [['30 min', 30], ['1 hour', 60], ['2 hours', 120]].map(([text, m]) => ({ text, onPress: () => sendCheckCall({ status: 'delayed', delayMinutes: m }) }));
    if (Platform.OS === 'ios') opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('How long is the delay?', undefined, opts, { cancelable: true });
  };

  // Pickup no-show prediction: the server flags at_risk/late_certain; the driver answers here.
  const answerPickup = async (status) => {
    setActionLoading(true);
    try {
      await api.post(`/loads/${load._id}/pickup-confirm`, { status });
      await refreshLoad();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not send your answer');
    }
    setActionLoading(false);
  };
  const cantMakeIt = () => Alert.alert(
    "Tell the shipper you can't make it?",
    'The shipper will be notified and may release the load to other carriers. Your booking is not cancelled by this.',
    [{ text: 'Back', style: 'cancel' }, { text: "I can't make it", style: 'destructive', onPress: () => answerPickup('cannot_make_it') }],
  );

  // Shipper asked to change the pickup time of this booked load. The agreed time stays in force until the driver accepts.
  const answerWindow = async (accept) => {
    setActionLoading(true);
    try {
      await api.post(`/loads/${load._id}/pickup-window-response`, { accept });
      Alert.alert(accept ? 'New pickup time accepted' : 'Agreed time kept', accept ? 'The pickup time was changed.' : 'The pickup time stays as agreed.');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not send your answer');
    }
    await refreshLoad();
    setActionLoading(false);
  };
  const fmtWindow = (w) => (w?.end ? `${fmtFull(w.start)} to ${fmtFull(w.end)}` : fmtFull(w?.start));

  // ── Accept load ────────────────────────────────────────────────
  const handleAccept = async () => {
    setActionLoading(true);
    try {
      // Send the terms version the driver is looking at; the server refuses if the shipper changed the load since.
      await api.put(`/loads/${load._id}/accept`, { termsVersion: load.termsVersion ?? 1 });
      Alert.alert('Success', 'Load accepted!');
      await refreshLoad();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Could not accept');
      if (err.response?.data?.code === 'TERMS_CHANGED') await refreshLoad(); // show the new details
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

      {/* Pickup time change asked by the shipper — the agreed window is bookedWindow (pickupTimeWindow equals it) */}
      {load.status === 'accepted' && load.pickupWindowChange?.status === 'pending' && (() => {
        const ch = load.pickupWindowChange;
        const expiresAt = new Date(new Date(ch.proposedAt).getTime() + 24 * 60 * 60 * 1000);
        const expired = expiresAt.getTime() < Date.now();
        return (
          <View style={[styles.card, { borderColor: COLORS.warning }]}>
            <Text style={styles.sectionTitle}>
              The shipper asks to change pickup to {fmtWindow({ start: ch.proposedStart, end: ch.proposedEnd })} (currently {fmtWindow(load.bookedWindow?.start ? load.bookedWindow : load.pickupTimeWindow)}).
            </Text>
            <Text style={styles.facilityAddr}>
              If you don't answer, the agreed time stays in force. {expired ? 'This request has expired.' : `The request expires ${fmtFull(expiresAt)}, 24 hours after it was proposed.`}
            </Text>
            <View style={{ marginTop: 10 }}>
              {!expired && <ActionButton label="Accept new time" color={COLORS.success} onPress={() => answerWindow(true)} disabled={actionLoading} />}
              <ActionButton label="Keep agreed time" color={COLORS.info} onPress={() => answerWindow(false)} disabled={actionLoading} />
            </View>
          </View>
        );
      })()}

      {/* Check call — one-tap status for the shipper; highlighted when the system is asking */}
      {booked && (
        <View style={[styles.card, pendingAsk && { borderColor: COLORS.warning }]}>
          <Text style={styles.sectionTitle}>{pendingAsk ? 'The shipper is waiting for a status update' : 'Give the shipper a quick status'}</Text>
          {pendingAsk && <Text style={styles.facilityAddr}>We cannot see a current position for this load.</Text>}
          <View style={{ marginTop: 10 }}>
            <ActionButton label="On schedule" color={COLORS.success} onPress={() => sendCheckCall({ status: 'on_schedule' })} disabled={actionLoading} />
            <ActionButton label="Delayed…" color={COLORS.warning} onPress={askDelay} disabled={actionLoading} />
            <ActionButton label="At facility" color={COLORS.info} onPress={() => sendCheckCall({ status: 'at_facility' })} disabled={actionLoading} />
            <ActionButton label="Stopped" color={COLORS.textMuted} onPress={() => sendCheckCall({ status: 'stopped' })} disabled={actionLoading} />
          </View>
        </View>
      )}

      {/* Pickup risk — shown only when the server predicts a missed pickup and the driver has not answered */}
      {load.status === 'accepted' && ['at_risk', 'late_certain'].includes(load.pickupRisk?.level) && !load.pickupRisk?.carrierConfirmation?.status && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Are you on the way to {load.pickupFacilityName || load.pickupAddress || load.origin}?</Text>
          <Text style={styles.facilityAddr}>
            {load.pickupRisk.detail?.distanceMilesStraight != null
              ? `GPS shows you about ${load.pickupRisk.detail.distanceMilesStraight} miles away (estimate, straight-line).`
              : "We're not receiving your location. Start your trip or enable tracking."}
          </Text>
          <View style={{ marginTop: 10 }}>
            <ActionButton label="On my way" color={COLORS.success} onPress={() => answerPickup('on_my_way')} disabled={actionLoading} />
            <ActionButton label="I can't make it" color={COLORS.error} onPress={cantMakeIt} disabled={actionLoading} />
          </View>
        </View>
      )}

      {/* Pickup code — show to the dock to prove this truck belongs to the booked carrier */}
      {pickup && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pickup code</Text>
          {pickup.code ? (
            <>
              <Text style={styles.pickupCode}>{pickup.code}</Text>
              <Text style={styles.facilityAddr}>Show this code to the dock. Never share it by phone, text or email.</Text>
              {load.pickupVerification?.required && (
                <Text style={styles.facilityAddr}>The shipper requires this check before you can start the trip.</Text>
              )}
            </>
          ) : (
            <Text style={[styles.facilityValue, { color: COLORS.success }]}>
              Verified at {new Date(pickup.verifiedAt).toLocaleString()}
            </Text>
          )}
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
            label={`Pickup photos${load.evidenceRequired?.pickup ? ' (required)' : ''}`}
            color={COLORS.indigo}
            onPress={() => addPhoto('pickup')}
            disabled={actionLoading}
          />
        )}

        {load.status === 'in-transit' && (
          <ActionButton
            label={`Delivery photos${load.evidenceRequired?.delivery ? ' (required)' : ''}`}
            color={COLORS.indigo}
            onPress={() => addPhoto('delivery')}
            disabled={actionLoading}
          />
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
  pickupCode: { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: 8, textAlign: 'center', marginVertical: 8 },
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
