import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import api from '../services/api';
import { COLORS } from '../constants/config';
import SignatureCapture from '../components/SignatureCapture';

export default function PODUploadScreen({ route, navigation }) {
  const { loadId } = route.params;
  const [image, setImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const [signerName, setSignerName] = useState('');

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera access is needed to take POD photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      setImage(result.assets[0]);
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      setImage(result.assets[0]);
    }
  };

  const handleSignatureSave = (signature) => {
    setSignatureData(signature);
    setSignatureModalVisible(false);
  };

  const handleSignatureCancel = () => {
    setSignatureModalVisible(false);
  };

  const clearSignature = () => {
    setSignatureData(null);
    setSignerName('');
  };

  const uploadPOD = async () => {
    if (!image) {
      Alert.alert('No Photo', 'Please take or select a photo first.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      const filename = image.uri.split('/').pop();
      const ext = filename.split('.').pop();
      formData.append('pod', {
        uri: image.uri,
        name: `pod_${loadId}.${ext}`,
        type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });

      // Include signature data if captured
      if (signatureData) {
        formData.append('signatureData', signatureData);
      }
      if (signerName) {
        formData.append('signerName', signerName);
      }

      await api.post(`/documents/pod/${loadId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      Alert.alert('Success', 'Proof of Delivery uploaded successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Upload Failed', err.response?.data?.error || 'Could not upload POD');
    }
    setUploading(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Proof of Delivery</Text>
      <Text style={styles.subtitle}>Take a photo or select from gallery</Text>

      {/* Photo preview */}
      {image ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: image.uri }} style={styles.preview} resizeMode="contain" />
          <TouchableOpacity style={styles.removeBtn} onPress={() => setImage(null)}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No photo selected</Text>
        </View>
      )}

      {/* Camera / Gallery buttons */}
      <View style={styles.row}>
        <TouchableOpacity style={styles.pickBtn} onPress={takePhoto}>
          <Text style={styles.pickBtnText}>Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pickBtn, styles.pickBtnAlt]} onPress={pickFromGallery}>
          <Text style={styles.pickBtnText}>Gallery</Text>
        </TouchableOpacity>
      </View>

      {/* Signature section */}
      <View style={styles.signatureSection}>
        <Text style={styles.signatureTitle}>Digital Signature (Optional)</Text>
        {signatureData ? (
          <View style={styles.signaturePreviewContainer}>
            {signerName ? (
              <Text style={styles.signerNameText}>Signed by: {signerName}</Text>
            ) : null}
            <Image
              source={{ uri: signatureData }}
              style={styles.signaturePreview}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.clearSigBtn} onPress={clearSignature}>
              <Text style={styles.clearSigBtnText}>Remove Signature</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addSigBtn}
            onPress={() => setSignatureModalVisible(true)}
          >
            <Text style={styles.addSigBtnText}>Capture Signature</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Upload button */}
      <TouchableOpacity
        style={[styles.uploadBtn, (!image || uploading) && { opacity: 0.5 }]}
        onPress={uploadPOD}
        disabled={!image || uploading}
      >
        {uploading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.uploadBtnText}>Upload POD</Text>
        )}
      </TouchableOpacity>

      {/* Signature capture modal */}
      <SignatureCapture
        visible={signatureModalVisible}
        onSave={handleSignatureSave}
        onCancel={handleSignatureCancel}
        signerName={signerName}
        onSignerNameChange={setSignerName}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 20, paddingBottom: 100 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: COLORS.textMuted, fontSize: 14, marginBottom: 20 },
  previewContainer: { alignItems: 'center', marginBottom: 16 },
  preview: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    backgroundColor: COLORS.bgCard,
  },
  removeBtn: { marginTop: 8 },
  removeBtnText: { color: COLORS.error, fontSize: 14, fontWeight: '600' },
  placeholder: {
    height: 200,
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  placeholderText: { color: COLORS.textMuted, fontSize: 15 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  pickBtn: {
    flex: 1,
    backgroundColor: COLORS.indigo,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pickBtnAlt: { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.indigo },
  pickBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  signatureSection: {
    marginBottom: 20,
    backgroundColor: COLORS.bgCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  signatureTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  signaturePreviewContainer: {
    alignItems: 'center',
  },
  signerNameText: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginBottom: 8,
  },
  signaturePreview: {
    width: '100%',
    height: 120,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  clearSigBtn: {
    marginTop: 8,
  },
  clearSigBtnText: {
    color: COLORS.error,
    fontSize: 13,
    fontWeight: '600',
  },
  addSigBtn: {
    borderWidth: 1,
    borderColor: 'rgba(0, 199, 183, 0.3)',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addSigBtnText: {
    color: '#00C7B7',
    fontWeight: '700',
    fontSize: 14,
  },
  uploadBtn: {
    backgroundColor: COLORS.success,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  uploadBtnText: { color: '#000', fontWeight: '800', fontSize: 16 },
});
