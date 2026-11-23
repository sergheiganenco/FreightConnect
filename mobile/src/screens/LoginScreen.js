import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/config';

export default function LoginScreen() {
  const { login, logout, completePasswordChange, cancelPasswordChange } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [pwChange, setPwChange] = useState(null); // login response while a temporary password must be replaced
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSetPassword = async () => {
    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (newPassword === password) {
      Alert.alert('Error', 'New password must be different from the temporary password');
      return;
    }
    setLoading(true);
    try {
      await completePasswordChange(pwChange, password, newPassword);
    } catch (err) {
      Alert.alert('Could not change password', err.response?.data?.error || 'Please try again');
      setLoading(false);
    }
  };

  const handleBack = async () => {
    await cancelPasswordChange();
    setPwChange(null);
    setNewPassword('');
    setConfirmPassword('');
    setPassword('');
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    if (mfaRequired && !mfaCode.trim()) {
      Alert.alert('Error', 'Please enter your 6-digit authentication code');
      return;
    }
    setLoading(true);
    try {
      const data = await login(
        email.trim().toLowerCase(),
        password,
        mfaRequired ? mfaCode.trim() : undefined
      );

      // Account has MFA enabled — prompt for the code and retry.
      if (data.mfaRequired && !data.token) {
        setMfaRequired(true);
        setLoading(false);
        return;
      }

      const role = data.user?.role || data.role;
      if (data.user?.mustChangePassword) {
        if (role !== 'carrier') {
          await cancelPasswordChange(); // login() kept only the token; nothing else to clear
          Alert.alert('Access Denied', 'This app is for carrier drivers only. Please use the web portal.');
          return;
        }
        setPwChange(data);
        return;
      }
      if (role !== 'carrier') {
        // login() already persisted the session; clear it so a non-carrier isn't
        // left signed into the driver app.
        await logout();
        Alert.alert('Access Denied', 'This app is for carrier drivers only. Please use the web portal.');
        return;
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Login failed';
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.logo}>FreightConnect</Text>
        <Text style={styles.subtitle}>Carrier Driver App</Text>

        {pwChange ? (
          <>
            <Text style={styles.subtitle}>Set a new password</Text>
            <TextInput
              style={styles.input}
              placeholder="New password (min 8 characters)"
              placeholderTextColor={COLORS.textMuted}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor={COLORS.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSetPassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Password</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleBack} disabled={loading}>
              <Text style={styles.hint}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
        <>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={COLORS.textMuted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={COLORS.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!mfaRequired}
        />

        {mfaRequired && (
          <TextInput
            style={styles.input}
            placeholder="6-digit authentication code"
            placeholderTextColor={COLORS.textMuted}
            value={mfaCode}
            onChangeText={setMfaCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{mfaRequired ? 'Verify Code' : 'Sign In'}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Use your FreightConnect carrier account credentials
        </Text>
        </>
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  logo: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 28,
  },
  input: {
    backgroundColor: COLORS.bgInput,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
});
