import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { isTracking, stopBackgroundTracking } from '../services/tracking';
import { COLORS } from '../constants/config';

export default function ProfileScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [trackingActive, setTrackingActive] = useState(false);

  useEffect(() => {
    (async () => {
      const running = await isTracking();
      setTrackingActive(running);
    })();
  }, []);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          if (trackingActive) {
            await stopBackgroundTracking();
          }
          await logout();
        },
      },
    ]);
  };

  const handleStopTracking = async () => {
    await stopBackgroundTracking();
    setTrackingActive(false);
    Alert.alert('Stopped', 'Background GPS tracking has been stopped.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name || user?.email || '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name || 'Carrier Driver'}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
        <Text style={styles.role}>{user?.role?.toUpperCase()}</Text>
      </View>

      {/* Company info */}
      {user?.company && (
        <View style={styles.infoCard}>
          <Row label="Company" value={user.company} />
          {user?.dotNumber && <Row label="DOT #" value={user.dotNumber} />}
          {user?.mcNumber && <Row label="MC #" value={user.mcNumber} />}
        </View>
      )}

      {/* Tracking status */}
      <View style={styles.infoCard}>
        <Text style={styles.sectionTitle}>GPS Tracking</Text>
        <View style={styles.trackingRow}>
          <View style={[styles.dot, { backgroundColor: trackingActive ? COLORS.success : COLORS.textMuted }]} />
          <Text style={styles.trackingStatus}>
            {trackingActive ? 'Active — location is being sent' : 'Inactive'}
          </Text>
        </View>
        {trackingActive && (
          <TouchableOpacity style={styles.stopBtn} onPress={handleStopTracking}>
            <Text style={styles.stopBtnText}>Stop Tracking</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={{ marginTop: 12, backgroundColor: COLORS.bgInput, borderRadius: 9999, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }}
          onPress={() => navigation.navigate('Loads', { screen: 'Consent' })}
        >
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 }}>Manage GPS Consent</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { color: '#fff', fontSize: 20, fontWeight: '700' },
  email: { color: COLORS.textMuted, fontSize: 14, marginTop: 2 },
  role: { color: COLORS.indigo, fontSize: 12, fontWeight: '700', marginTop: 6, letterSpacing: 1 },
  infoCard: {
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
  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  trackingStatus: { color: '#fff', fontSize: 14 },
  stopBtn: {
    backgroundColor: COLORS.error,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  stopBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  logoutBtn: {
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  logoutText: { color: COLORS.error, fontWeight: '700', fontSize: 15 },
});
