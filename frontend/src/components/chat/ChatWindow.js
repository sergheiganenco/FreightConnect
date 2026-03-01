import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, TextField, IconButton, CircularProgress, Divider,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MessageBubble from './MessageBubble';
import { useChatContext } from './ChatProvider';
import { surface, text as T, gradient, semantic } from '../../theme/tokens';

export default function ChatWindow({ channelId }) {
  const {
    channels, messages, typingUsers, sendMessage, emitTyping, fetchMessages,
  } = useChatContext();

  const userId = localStorage.getItem('userId');
  const [input, setInput] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  const channel = channels.find((c) => c.channelId === channelId);
  const channelMessages = messages[channelId] || [];
  const typing = typingUsers[channelId] || [];
  const isLocked = channel?.status === 'locked';

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length]);

  // Load older messages on scroll to top
  const handleScroll = async () => {
    if (!containerRef.current) return;
    if (containerRef.current.scrollTop > 50) return;
    if (loadingOlder || channelMessages.length === 0) return;
    const oldest = channelMessages[0];
    setLoadingOlder(true);
    await fetchMessages(channelId, oldest.createdAt);
    setLoadingOlder(false);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLocked) return;
    sendMessage(channelId, trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    emitTyping(channelId);
  };

  if (!channel) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <Typography sx={{ color: T.hint }}>Select a conversation</Typography>
      </Box>
    );
  }

  const title = channel.channelType === 'load_thread'
    ? `Load: ${channel.loadId?.title || channelId}`
    : channel.channelType === 'direct'
    ? channel.participants?.find((p) => p.user?._id !== userId)?.user?.name || 'Direct Message'
    : channel.communityInfo?.name || 'Community';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${surface.glassBorder}` }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {title}
        </Typography>
        {channel.channelType === 'load_thread' && channel.loadId && (
          <Typography variant="caption" sx={{ color: T.muted }}>
            {channel.loadId.origin} → {channel.loadId.destination}
          </Typography>
        )}
        {isLocked && (
          <Typography variant="caption" sx={{ color: semantic.warning, display: 'block' }}>
            This chat is locked
          </Typography>
        )}
      </Box>

      {/* Messages */}
      <Box
        ref={containerRef}
        onScroll={handleScroll}
        sx={{ flex: 1, overflowY: 'auto', py: 1, px: 0.5 }}
      >
        {loadingOlder && (
          <Box sx={{ textAlign: 'center', py: 1 }}>
            <CircularProgress size={16} />
          </Box>
        )}
        {channelMessages.length === 0 && (
          <Box sx={{ textAlign: 'center', mt: 4 }}>
            <Typography sx={{ color: T.hint, fontSize: '0.85rem' }}>
              No messages yet. Say hello!
            </Typography>
          </Box>
        )}
        {channelMessages.map((msg) => (
          <MessageBubble
            key={msg._id}
            message={msg}
            isOwn={msg.sender?._id === userId || msg.sender === userId}
          />
        ))}
        {typing.length > 0 && (
          <Box sx={{ pl: 2, pb: 1 }}>
            <Typography variant="caption" sx={{ color: T.hint, fontStyle: 'italic' }}>
              Someone is typing…
            </Typography>
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      <Divider sx={{ borderColor: surface.glassBorder }} />

      {/* Input */}
      <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          placeholder={isLocked ? 'This conversation is locked' : 'Type a message…'}
          disabled={isLocked}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 3,
              background: surface.glassLight,
              color: T.primary,
              '& fieldset': { borderColor: surface.glassBorder },
              '&:hover fieldset': { borderColor: T.hint },
            },
            '& .MuiInputBase-input': { color: T.primary },
          }}
        />
        <IconButton
          onClick={handleSend}
          disabled={isLocked || !input.trim()}
          sx={{
            background: gradient.primary,
            color: T.primary,
            '&:hover': { opacity: 0.85 },
            '&.Mui-disabled': { background: surface.glassHover, color: T.hint },
          }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
