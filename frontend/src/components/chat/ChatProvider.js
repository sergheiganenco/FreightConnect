import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { Snackbar, Alert, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { getSocket } from '../../services/socket';

const ChatContext = createContext(null);

export function useChatContext() {
  return useContext(ChatContext);
}

export default function ChatProvider({ children }) {
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState({}); // { [channelId]: Message[] }
  const [typingUsers, setTypingUsers] = useState({}); // { [channelId]: userId[] }
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [matchAlert, setMatchAlert] = useState(null); // {title, origin, destination, rate, score}
  const [bidAlert, setBidAlert] = useState(null);    // {loadTitle, amount, action}
  const typingTimers = useRef({});

  const token = localStorage.getItem('token');
  const userId = localStorage.getItem('userId');

  // ── Fetch channel list ─────────────────────────────────────────
  const fetchChannels = useCallback(async () => {
    if (!token) return;
    setLoadingChannels(true);
    try {
      const { data } = await axios.get(
        `${process.env.REACT_APP_API_URL}/chat/channels`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setChannels(data);
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    } finally {
      setLoadingChannels(false);
    }
  }, [token]);

  // ── Fetch messages for a channel ───────────────────────────────
  const fetchMessages = useCallback(async (channelId, before = null) => {
    if (!token) return;
    try {
      const params = before ? `?before=${before}&limit=50` : '?limit=50';
      const { data } = await axios.get(
        `${process.env.REACT_APP_API_URL}/chat/channels/${channelId}/messages${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessages((prev) => {
        if (before) {
          // Prepend older messages
          const existing = prev[channelId] || [];
          return { ...prev, [channelId]: [...data, ...existing] };
        }
        return { ...prev, [channelId]: data };
      });
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, [token]);

  // ── Open a channel ─────────────────────────────────────────────
  const openChannel = useCallback((channelId) => {
    setActiveChannelId(channelId);
    getSocket()?.emit('joinChannel', { channelId });
    fetchMessages(channelId);
    // Mark as read
    if (token) {
      axios.post(
        `${process.env.REACT_APP_API_URL}/chat/channels/${channelId}/read`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => {});
      // Clear unread locally
      setChannels((prev) =>
        prev.map((ch) =>
          ch.channelId === channelId ? { ...ch, unreadCount: 0 } : ch
        )
      );
    }
  }, [token, fetchMessages]);

  // ── Send a message ─────────────────────────────────────────────
  const sendMessage = useCallback(async (channelId, content, messageType = 'text') => {
    if (!token || !content.trim()) return;
    try {
      const { data } = await axios.post(
        `${process.env.REACT_APP_API_URL}/chat/channels/${channelId}/messages`,
        { content, messageType },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Optimistically already handled by socket; if socket fails, add here
      setMessages((prev) => {
        const existing = prev[channelId] || [];
        const alreadyExists = existing.some((m) => m._id === data._id);
        if (alreadyExists) return prev;
        return { ...prev, [channelId]: [...existing, data] };
      });
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [token]);

  // ── Typing indicators ──────────────────────────────────────────
  const emitTyping = useCallback((channelId) => {
    getSocket()?.emit('typing', { channelId });
    clearTimeout(typingTimers.current[channelId]);
    typingTimers.current[channelId] = setTimeout(() => {
      getSocket()?.emit('stopTyping', { channelId });
    }, 2000);
  }, []);

  // ── Total unread count (for nav badge) ────────────────────────
  const totalUnread = channels.reduce((sum, ch) => sum + (ch.unreadCount || 0), 0);

  // ── Socket event listeners ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    fetchChannels();

    const s = getSocket();
    if (!s) return;

    // New message arrives
    s.on('newMessage', (message) => {
      const { channelId } = message;
      setMessages((prev) => {
        const existing = prev[channelId] || [];
        const alreadyExists = existing.some((m) => m._id === message._id);
        if (alreadyExists) return prev;
        return { ...prev, [channelId]: [...existing, message] };
      });
      // Update sidebar preview + unread
      setChannels((prev) =>
        prev.map((ch) =>
          ch.channelId === channelId
            ? {
                ...ch,
                lastMessagePreview: message.content,
                lastMessageAt: message.createdAt,
                unreadCount:
                  message.sender?._id === userId || channelId === activeChannelId
                    ? ch.unreadCount || 0
                    : (ch.unreadCount || 0) + 1,
              }
            : ch
        )
      );
    });

    // Message edited
    s.on('messageEdited', (updated) => {
      setMessages((prev) => {
        const list = prev[updated.channelId] || [];
        return {
          ...prev,
          [updated.channelId]: list.map((m) =>
            m._id === updated._id ? updated : m
          ),
        };
      });
    });

    // Message deleted
    s.on('messageDeleted', ({ messageId, channelId }) => {
      setMessages((prev) => {
        const list = prev[channelId] || [];
        return {
          ...prev,
          [channelId]: list.map((m) =>
            m._id === messageId ? { ...m, deleted: true, content: '[Message deleted]' } : m
          ),
        };
      });
    });

    // Typing
    s.on('userTyping', ({ channelId, userId: typingId }) => {
      setTypingUsers((prev) => ({
        ...prev,
        [channelId]: [...new Set([...(prev[channelId] || []), typingId])],
      }));
    });
    s.on('userStoppedTyping', ({ channelId, userId: typingId }) => {
      setTypingUsers((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] || []).filter((id) => id !== typingId),
      }));
    });

    // New channel created for this user
    s.on(`chat:channelCreated:${userId}`, () => {
      fetchChannels();
    });

    // New load match notification for carriers
    s.on('newLoadMatch', (data) => {
      setMatchAlert(data);
    });

    // Bid event notifications
    s.on('bid:new', ({ loadTitle, amount }) => {
      setBidAlert({ loadTitle, amount, action: 'new' });
    });
    s.on('bid:accepted', ({ loadTitle, finalAmount }) => {
      setBidAlert({ loadTitle, amount: finalAmount, action: 'accepted' });
    });
    s.on('bid:rejected', ({ loadTitle }) => {
      setBidAlert({ loadTitle, action: 'rejected' });
    });
    s.on('bid:countered', ({ loadTitle, counterAmount }) => {
      setBidAlert({ loadTitle, amount: counterAmount, action: 'countered' });
    });

    return () => {
      s.off('newMessage');
      s.off('messageEdited');
      s.off('messageDeleted');
      s.off('userTyping');
      s.off('userStoppedTyping');
      s.off(`chat:channelCreated:${userId}`);
      s.off('newLoadMatch');
      s.off('bid:new');
      s.off('bid:accepted');
      s.off('bid:rejected');
      s.off('bid:countered');
    };
  }, [token, userId, fetchChannels, activeChannelId]);

  const value = {
    channels,
    activeChannelId,
    messages,
    typingUsers,
    loadingChannels,
    totalUnread,
    openChannel,
    sendMessage,
    emitTyping,
    fetchChannels,
    fetchMessages,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
      {/* Load match toast */}
      <Snackbar
        open={!!matchAlert}
        autoHideDuration={8000}
        onClose={() => setMatchAlert(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="info"
          icon={<AutoAwesomeIcon fontSize="small" />}
          onClose={() => setMatchAlert(null)}
          sx={{ background: 'rgba(30,15,60,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(106,31,207,0.4)', color: '#fff' }}
        >
          <Typography variant="body2" fontWeight={700}>New Load Match! ({matchAlert?.score}% match)</Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
            {matchAlert?.origin} → {matchAlert?.destination} · ${matchAlert?.rate?.toLocaleString()}
          </Typography>
        </Alert>
      </Snackbar>

      {/* Bid activity toast */}
      <Snackbar
        open={!!bidAlert}
        autoHideDuration={6000}
        onClose={() => setBidAlert(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={bidAlert?.action === 'accepted' ? 'success' : bidAlert?.action === 'rejected' ? 'error' : 'info'}
          onClose={() => setBidAlert(null)}
          sx={{ background: 'rgba(10,10,30,0.95)', backdropFilter: 'blur(12px)', border: '1px solid rgba(99,102,241,0.4)', color: '#fff' }}
        >
          <Typography variant="body2" fontWeight={700}>
            {bidAlert?.action === 'new' && 'New bid received'}
            {bidAlert?.action === 'accepted' && 'Bid accepted! 🎉'}
            {bidAlert?.action === 'rejected' && 'Bid rejected'}
            {bidAlert?.action === 'countered' && 'Shipper countered your bid'}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
            {bidAlert?.loadTitle}
            {bidAlert?.amount ? ` · $${bidAlert.amount.toLocaleString()}` : ''}
          </Typography>
        </Alert>
      </Snackbar>
    </ChatContext.Provider>
  );
}
