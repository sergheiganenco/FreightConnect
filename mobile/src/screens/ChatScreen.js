import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/config';

export default function ChatScreen() {
  const { user } = useAuth();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef(null);

  // Fetch channels
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/chat/channels');
        setChannels(data.channels || data || []);
      } catch (err) {
        console.error('Channels fetch error:', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch messages when channel selected
  const fetchMessages = useCallback(async (channelId) => {
    try {
      const { data } = await api.get(`/chat/channels/${channelId}/messages?limit=50`);
      setMessages((data.messages || data || []).reverse());
    } catch (err) {
      console.error('Messages fetch error:', err.message);
    }
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    // Backend keys channels on the string `channelId` (e.g. "load_<id>"), not the Mongo _id.
    const channelId = activeChannel.channelId;
    fetchMessages(channelId);

    // Join socket room. getSocket() is async, so capture the socket in a ref that the
    // effect cleanup (which must return synchronously) can reach.
    let socketRef = null;
    let cancelled = false;
    const handleNewMessage = (msg) => {
      if (msg.channelId === channelId) {
        setMessages((prev) => [...prev, msg]);
      }
    };
    (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;
      socketRef = socket;
      socket.emit('joinChannel', { channelId });
      socket.on('newMessage', handleNewMessage);
    })();

    return () => {
      cancelled = true;
      if (socketRef) {
        socketRef.emit('leaveChannel', { channelId });
        socketRef.off('newMessage', handleNewMessage);
      }
    };
  }, [activeChannel, fetchMessages]);

  const sendMessage = async () => {
    if (!text.trim() || !activeChannel) return;
    setSending(true);
    try {
      await api.post(`/chat/channels/${activeChannel.channelId}/messages`, {
        content: text.trim(),
      });
      setText('');
    } catch (err) {
      console.error('Send failed:', err.message);
    }
    setSending(false);
  };

  // ── Channel list view ──────────────────────────────────────────
  if (!activeChannel) {
    return (
      <View style={styles.container}>
        <Text style={styles.header}>Messages</Text>
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : channels.length === 0 ? (
          <Text style={styles.empty}>No conversations yet. Accept a load to start chatting.</Text>
        ) : (
          <FlatList
            data={channels}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.channelCard}
                onPress={() => setActiveChannel(item)}
              >
                <Text style={styles.channelName} numberOfLines={1}>
                  {item.loadId?.title || item.name || item.channelId || 'Chat'}
                </Text>
                {item.lastMessage && (
                  <Text style={styles.channelPreview} numberOfLines={1}>
                    {item.lastMessage.content}
                  </Text>
                )}
                {item.unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{item.unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header with back button */}
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => setActiveChannel(null)}>
          <Text style={styles.backBtn}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.chatTitle} numberOfLines={1}>
          {activeChannel.loadId?.title || activeChannel.name || 'Chat'}
        </Text>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => {
          // Login stores the user as { id }, so compare against both id and _id.
          const myId = user?.id || user?._id;
          const isMe = item.sender?._id === myId || item.sender === myId;
          const isSystem = item.sender === 'system' || item.type === 'system';
          if (isSystem) {
            return (
              <View style={styles.systemMsg}>
                <Text style={styles.systemMsgText}>{item.content}</Text>
              </View>
            );
          }
          return (
            <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
              {!isMe && (
                <Text style={styles.senderName}>
                  {item.sender?.name || item.senderName || 'User'}
                </Text>
              )}
              <Text style={styles.msgText}>{item.content}</Text>
              <Text style={styles.msgTime}>
                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
        contentContainerStyle={styles.msgList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={COLORS.textMuted}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
          onPress={sendMessage}
          disabled={!text.trim() || sending}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  header: { color: '#fff', fontSize: 22, fontWeight: '800', padding: 16, paddingTop: 12 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 20, fontSize: 15 },
  channelCard: {
    backgroundColor: COLORS.bgCard,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelName: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  channelPreview: { color: COLORS.textMuted, fontSize: 13, flex: 2, marginLeft: 8 },
  unreadBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { color: COLORS.indigo, fontSize: 15, fontWeight: '600', marginRight: 12 },
  chatTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  msgList: { padding: 16, paddingBottom: 8 },
  bubble: { maxWidth: '80%', borderRadius: 12, padding: 10, marginBottom: 8 },
  bubbleMe: { backgroundColor: COLORS.primary, alignSelf: 'flex-end' },
  bubbleThem: { backgroundColor: COLORS.bgCard, alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.border },
  senderName: { color: COLORS.indigo, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  msgText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  msgTime: { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 4, textAlign: 'right' },
  systemMsg: { alignSelf: 'center', marginBottom: 8 },
  systemMsgText: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bgCard,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.bgInput,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    marginRight: 8,
  },
  sendBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
