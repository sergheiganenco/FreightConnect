import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { hasGpsConsent, setGpsConsent } from '../services/tracking';
import { COLORS } from '../constants/config';

export default function ConsentScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granted, setGranted] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    setGranted(await hasGpsConsent());
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const grant = async () => {
    setSaving(true);
    try {
      const c = await setGpsConsent(true);
      setGranted(Boolean(c?.granted));
      Alert.alert('Consent saved', 'You can now start GPS tracking on your loads.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (_) {
      Alert.alert('Error', 'Could not save consent. Please try again.');
    }
    setSaving(false);
  };

  const revoke = async () => {
    setSaving(true);
    try {
      const c = await setGpsConsent(false);
      setGranted(Boolean(c?.granted));
    } catch (_) {
      Alert.alert('Error', 'Could not update consent.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.title}>GPS Tracking Consent</Text>

      <View style={styles.card}>
        <Text style={styles.body}>
          FreightConnect uses your phone&apos;s location only while you&apos;re hauling a
          load, to:
        </Text>
        <Text style={styles.bullet}>•  Share live ETA with the shipper</Text>
        <Text style={styles.bullet}>•  Automatically document detention time at facilities</Text>
        <Text style={styles.bullet}>•  Plan and verify your route</Text>
        <Text style={styles.body}>
          We don&apos;t track you off-duty. You can withdraw consent at any time —
          tracking stops immediately. Location history is retained to support detention
          and dispute claims.
        </Text>
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: granted ? COLORS.success : COLORS.textMuted }]} />
        <Text style={styles.status}>{granted ? 'Consent granted' : 'Consent not granted'}</Text>
      </View>

      {granted ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: COLORS.error }]}
          onPress={revoke}
          disabled={saving}
        >
          <Text style={styles.btnText}>{saving ? 'Saving…' : 'Withdraw Consent'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: COLORS.primary }]}
          onPress={grant}
          disabled={saving}
        >
          <Text style={styles.btnText}>{saving ? 'Saving…' : 'I Consent to GPS Tracking'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bgDark },
  title: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  body: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 21, marginBottom: 10 },
  bullet: { color: COLORS.textMuted, fontSize: 14, lineHeight: 22, marginLeft: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  status: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },
  btn: { borderRadius: 9999, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
