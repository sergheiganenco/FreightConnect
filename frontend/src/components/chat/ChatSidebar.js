import React, { useState } from 'react';
import {
  Box, Typography, TextField, InputAdornment, Chip, Badge, CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import GroupsIcon from '@mui/icons-material/Groups';
import { useChatContext } from './ChatProvider';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const TYPE_LABELS = {
  load_thread: { label: 'Load Threads', icon: <LocalShippingIcon sx={{ fontSize: 14 }} /> },
  direct: { label: 'Direct Messages', icon: <ChatBubbleIcon sx={{ fontSize: 14 }} /> },
  community: { label: 'Communities', icon: <GroupsIcon sx={{ fontSize: 14 }} /> },
};

export default function ChatSidebar() {
  const { channels, activeChannelId, openChannel, loadingChannels } = useChatContext();
  const [search, setSearch] = useState('');

  const filtered = channels.filter((ch) => {
    if (!search.trim()) return true;
    const preview = ch.lastMessagePreview || '';
    const title = ch.loadId?.title || ch.communityInfo?.name || '';
    return (
      preview.toLowerCase().includes(search.toLowerCase()) ||
      title.toLowerCase().includes(search.toLowerCase())
    );
  });

  const grouped = { load_thread: [], direct: [], community: [] };
  filtered.forEach((ch) => {
    if (grouped[ch.channelType]) grouped[ch.channelType].push(ch);
  });

  const getChannelTitle = (ch) => {
    const userId = localStorage.getItem('userId');
    if (ch.channelType === 'load_thread') return ch.loadId?.title || `Load ${ch.channelId}`;
    if (ch.channelType === 'direct') {
      const other = ch.participants?.find((p) => p.user?._id !== userId);
      return other?.user?.name || 'Direct Message';
    }
    return ch.communityInfo?.name || 'Community';
  };

  return (
    <Box
      sx={{
        width: 280,
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
          Messages
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }} />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              background: 'rgba(255,255,255,0.04)',
              '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
            },
            '& .MuiInputBase-input': { color: '#fff', fontSize: '0.85rem' },
          }}
        />
      </Box>

      {/* Channel list */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1 }}>
        {loadingChannels && (
          <Box sx={{ textAlign: 'center', pt: 3 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {!loadingChannels && channels.length === 0 && (
          <Typography
            variant="caption"
            sx={{ color: 'rgba(255,255,255,0.25)', display: 'block', textAlign: 'center', pt: 3 }}
          >
            No conversations yet
          </Typography>
        )}
        {Object.entries(grouped).map(([type, list]) => {
          if (!list.length) return null;
          const { label, icon } = TYPE_LABELS[type];
          return (
            <Box key={type} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75 }}>
                {icon}
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: 0.8 }}>
                  {label.toUpperCase()}
                </Typography>
              </Box>
              {list.map((ch) => {
                const isActive = ch.channelId === activeChannelId;
                const hasUnread = ch.unreadCount > 0;
                return (
                  <Box
                    key={ch.channelId}
                    onClick={() => openChannel(ch.channelId)}
                    sx={{
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      cursor: 'pointer',
                      background: isActive ? 'rgba(106,31,207,0.25)' : 'transparent',
                      borderLeft: isActive ? '3px solid #6a1fcf' : '3px solid transparent',
                      '&:hover': { background: 'rgba(255,255,255,0.05)' },
                      mb: 0.25,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography
                        variant="body2"
                        fontWeight={hasUnread ? 700 : 500}
                        noWrap
                        sx={{ flex: 1, color: hasUnread ? '#fff' : 'rgba(255,255,255,0.8)' }}
                      >
                        {getChannelTitle(ch)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                        {hasUnread && (
                          <Chip
                            label={ch.unreadCount > 9 ? '9+' : ch.unreadCount}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.6rem',
                              background: '#e1129a',
                              color: '#fff',
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        )}
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                          {timeAgo(ch.lastMessageAt)}
                        </Typography>
                      </Box>
                    </Box>
                    {ch.lastMessagePreview && (
                      <Typography
                        variant="caption"
                        noWrap
                        sx={{ color: 'rgba(255,255,255,0.35)', display: 'block', mt: 0.25 }}
                      >
                        {ch.lastMessagePreview}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
