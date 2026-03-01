/**
 * NotificationBell
 *
 * Renders a bell icon button with a red unread badge.
 * Clicking opens a popover with the notification list.
 * Supports mark-as-read (single + all), dismiss, and navigation.
 *
 * Usage:
 *   <NotificationBell />
 *
 * Listens to socket event `notification:new` to update in real-time.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  IconButton, Badge, Popover, Box, Typography, Stack, Divider,
  Button, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { getSocket } from '../../services/socket';
import { brand, semantic, status as ST, surface, text as T, tint } from '../../theme/tokens';

// ── Icon + colour per notification type ────────────────────────────────────
const TYPE_META = {
  'bid:new':              { color: brand.indigo, label: 'New Bid' },
  'bid:accepted':         { color: semantic.success, label: 'Bid Accepted' },
  'bid:rejected':         { color: semantic.error, label: 'Bid Rejected' },
  'bid:countered':        { color: semantic.warning, label: 'Bid Countered' },
  'bid:counter_accepted': { color: semantic.success, label: 'Counter Accepted' },
  'load:status':          { color: brand.indigoLight, label: 'Load Update' },
  'load:matched':         { color: ST.accepted, label: 'Load Match' },
  'payment:escrowed':     { color: semantic.success, label: 'Payment Held' },
  'payment:released':     { color: semantic.success, label: 'Payout Released' },
  'doc:generated':        { color: '#60a5fa', label: 'Document Ready' },
  'exception:new':        { color: semantic.orange, label: 'Exception Filed' },
  'exception:updated':    { color: semantic.warning, label: 'Exception Updated' },
  'exception:note':       { color: '#fb923c', label: 'Exception Note' },
  'insurance:expiring':   { color: semantic.warning, label: 'Insurance Alert' },
  'insurance:lapsed':     { color: semantic.error, label: 'Insurance Lapsed' },
};

function NotificationItem({ notification, onRead, onDelete }) {
  const navigate = useNavigate();
  const meta = TYPE_META[notification.type] || { color: semantic.muted, label: 'Notification' };
  const isUnread = !notification.read;

  const handleClick = () => {
    if (isUnread) onRead(notification._id);
    if (notification.link) navigate(notification.link);
  };

  return (
    <Box
      onClick={handleClick}
      sx={{
        px: 2, py: 1.5,
        cursor: notification.link ? 'pointer' : 'default',
        bgcolor: isUnread ? surface.indigoTintLight : 'transparent',
        borderLeft: `3px solid ${isUnread ? meta.color : 'transparent'}`,
        transition: 'background 0.12s',
        '&:hover': { bgcolor: surface.indigoTint },
        position: 'relative',
      }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={1.5}>
        {/* Type dot */}
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%',
          bgcolor: meta.color, mt: 0.75, flexShrink: 0,
        }} />

        <Box flex={1} minWidth={0}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={0.5}>
            <Box flex={1} minWidth={0}>
              <Typography
                variant="body2"
                fontWeight={isUnread ? 700 : 400}
                sx={{ color: isUnread ? T.dark : 'text.secondary', lineHeight: 1.3 }}
                noWrap
              >
                {notification.title}
              </Typography>
              {notification.body && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }} noWrap>
                  {notification.body}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.25 }}>
                {new Date(notification.createdAt).toLocaleString(undefined, {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Typography>
            </Box>
            <Tooltip title="Dismiss">
              <IconButton
                size="small"
                onClick={e => { e.stopPropagation(); onDelete(notification._id); }}
                sx={{ color: 'text.disabled', '&:hover': { color: semantic.error }, p: 0.25, mt: -0.25 }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

export default function NotificationBell({ iconSx = {} }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const open = Boolean(anchorEl);
  const pollRef = useRef(null);

  const fetchNotifications = useCallback(async (p = 1, append = false) => {
    if (p === 1) setLoading(true);
    try {
      const { data } = await api.get(`/notifications?page=${p}&limit=15`);
      setNotifications(prev => append ? [...prev, ...(data.notifications || [])] : (data.notifications || []));
      setUnreadCount(data.unreadCount ?? 0);
      setHasMore(p < (data.pages || 1));
      setPage(p);
    } catch { /* silent */ }
    if (p === 1) setLoading(false);
  }, []);

  // Fetch unread count on mount and when popover closes
  const fetchCount = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications/unread-count');
      setUnreadCount(data.count ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchCount();
    // Poll every 60s for missed notifications (in case socket disconnected)
    pollRef.current = setInterval(fetchCount, 60_000);
    return () => clearInterval(pollRef.current);
  }, [fetchCount]);

  // Real-time: new notification pushed over socket
  useEffect(() => {
    const handler = (notification) => {
      setUnreadCount(c => c + 1);
      setNotifications(prev => [notification, ...prev]);
    };
    const s = getSocket();
    if (s) s.on('notification:new', handler);
    return () => { if (s) s.off('notification:new', handler); };
  }, []);

  const handleOpen = (e) => {
    setAnchorEl(e.currentTarget);
    fetchNotifications(1);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  };

  const handleReadAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* silent */ }
  };

  const handleDelete = async (id) => {
    const wasUnread = notifications.find(n => n._id === id)?.read === false;
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n._id !== id));
      if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    } catch { /* silent */ }
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={handleOpen} sx={{ color: T.primary, ...iconSx }}>
          <Badge
            badgeContent={unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : 0}
            color="error"
            sx={{ '& .MuiBadge-badge': { fontSize: '0.62rem', fontWeight: 700, minWidth: 16, height: 16, padding: '0 4px' } }}
          >
            {unreadCount > 0
              ? <NotificationsIcon sx={{ fontSize: 24 }} />
              : <NotificationsNoneIcon sx={{ fontSize: 24 }} />
            }
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          elevation: 12,
          sx: {
            width: 360,
            maxHeight: 520,
            borderRadius: 3,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${surface.indigoBorderLight}`,
          },
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5, bgcolor: surface.indigoTintLight, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle1" fontWeight={700}>Notifications</Typography>
            {unreadCount > 0 && (
              <Chip
                label={unreadCount}
                size="small"
                sx={{ bgcolor: semantic.error, color: T.primary, fontWeight: 700, fontSize: '0.68rem', height: 18, '& .MuiChip-label': { px: 0.75 } }}
              />
            )}
          </Stack>
          {unreadCount > 0 && (
            <Tooltip title="Mark all as read">
              <IconButton size="small" onClick={handleReadAll} sx={{ color: brand.indigo }}>
                <DoneAllIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        {/* Notification list */}
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <Stack alignItems="center" py={4}><CircularProgress size={24} sx={{ color: brand.indigo }} /></Stack>
          ) : notifications.length === 0 ? (
            <Stack alignItems="center" py={5} spacing={1}>
              <NotificationsNoneIcon sx={{ color: 'text.disabled', fontSize: 36 }} />
              <Typography variant="body2" color="text.secondary">No notifications yet</Typography>
            </Stack>
          ) : (
            <>
              {notifications.map((n, i) => (
                <React.Fragment key={n._id}>
                  <NotificationItem
                    notification={n}
                    onRead={handleRead}
                    onDelete={handleDelete}
                  />
                  {i < notifications.length - 1 && <Divider />}
                </React.Fragment>
              ))}
              {hasMore && (
                <Stack alignItems="center" py={1.5}>
                  <Button
                    size="small" variant="text"
                    onClick={() => fetchNotifications(page + 1, true)}
                    sx={{ color: brand.indigo, fontSize: '0.78rem' }}
                  >
                    Load more
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Box>
      </Popover>
    </>
  );
}
