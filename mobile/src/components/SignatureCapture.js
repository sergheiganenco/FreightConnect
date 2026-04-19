import React, { useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';

export default function SignatureCapture({ visible, onSave, onCancel, signerName, onSignerNameChange }) {
  const signatureRef = useRef(null);

  const handleOK = (signature) => {
    // signature is a base64-encoded PNG data URI
    onSave(signature);
  };

  const handleEmpty = () => {
    // User tried to save without drawing anything — ignore
  };

  const handleClear = () => {
    signatureRef.current?.clearSignature();
  };

  const handleUndo = () => {
    signatureRef.current?.undo();
  };

  const handleConfirm = () => {
    signatureRef.current?.readSignature();
  };

  const webStyle = `
    .m-signature-pad {
      box-shadow: none;
      border: none;
      margin: 0;
    }
    .m-signature-pad--body {
      border: none;
    }
    .m-signature-pad--footer {
      display: none;
    }
    body, html {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }
  `;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Capture Signature</Text>
          <Text style={styles.headerSub}>Consignee signature for Proof of Delivery</Text>
        </View>

        {/* Signer name input */}
        <View style={styles.nameSection}>
          <Text style={styles.label}>Signer Name (Consignee)</Text>
          <TextInput
            style={styles.nameInput}
            value={signerName}
            onChangeText={onSignerNameChange}
            placeholder="Enter name of person signing"
            placeholderTextColor="#6b7280"
            autoCapitalize="words"
          />
        </View>

        {/* Signature canvas */}
        <View style={styles.canvasSection}>
          <Text style={styles.label}>Signature</Text>
          <View style={styles.canvasWrapper}>
            <SignatureScreen
              ref={signatureRef}
              onOK={handleOK}
              onEmpty={handleEmpty}
              webStyle={webStyle}
              backgroundColor="#ffffff"
              penColor="#000000"
              dotSize={2}
              minWidth={1.5}
              maxWidth={3}
              descriptionText=""
              clearText=""
              confirmText=""
              style={styles.canvas}
            />
          </View>
          <Text style={styles.canvasHint}>Sign in the white area above</Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.undoBtn} onPress={handleUndo}>
              <Text style={styles.undoBtnText}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleConfirm}>
            <Text style={styles.saveBtnText}>Save Signature</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  headerSub: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 4,
  },
  nameSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  label: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  nameInput: {
    backgroundColor: '#1a2744',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(0, 199, 183, 0.2)',
  },
  canvasSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  canvasWrapper: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(0, 199, 183, 0.3)',
  },
  canvas: {
    flex: 1,
  },
  canvasHint: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    paddingTop: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  undoBtn: {
    flex: 1,
    backgroundColor: '#1a2744',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 199, 183, 0.2)',
  },
  undoBtnText: {
    color: '#00C7B7',
    fontWeight: '700',
    fontSize: 14,
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#1a2744',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
  },
  clearBtnText: {
    color: '#f87171',
    fontWeight: '700',
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: '#00C7B7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveBtnText: {
    color: '#0a1628',
    fontWeight: '800',
    fontSize: 16,
  },
  cancelBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#6b7280',
    fontWeight: '600',
    fontSize: 14,
  },
});
