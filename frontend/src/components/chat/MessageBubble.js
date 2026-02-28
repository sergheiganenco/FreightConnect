import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message, isOwn }) {
  const isSystem = message.messageType === 'system';

  if (isSystem) {
    return (
      <Box sx={{ textAlign: 'center', my: 1, px: 2 }}>
        <Typography
          variant="caption"
          sx={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}
        >
          {message.content}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isOwn ? 'flex-end' : 'flex-start',
        mb: 1,
        px: 1,
      }}
    >
      <Box sx={{ maxWidth: '70%' }}>
        {!isOwn && (
          <Typography
            variant="caption"
            sx={{ color: 'rgba(255,255,255,0.5)', mb: 0.25, display: 'block', pl: 1 }}
          >
            {message.sender?.name || 'Unknown'}
          </Typography>
        )}
        <Tooltip title={formatTime(message.createdAt)} placement={isOwn ? 'left' : 'right'}>
          <Box
            sx={{
              px: 2,
              py: 1,
              borderRadius: isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: isOwn
                ? 'linear-gradient(135deg, #6a1fcf, #e1129a)'
                : 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
              wordBreak: 'break-word',
            }}
          >
            <Typography variant="body2" sx={{ color: '#fff', lineHeight: 1.5 }}>
              {message.deleted ? (
                <em style={{ opacity: 0.5 }}>[Message deleted]</em>
              ) : (
                message.content
              )}
            </Typography>
            {message.edited && !message.deleted && (
              <Typography variant="caption" sx={{ opacity: 0.45, fontSize: '0.65rem' }}>
                {' '}edited
              </Typography>
            )}
          </Box>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255,255,255,0.3)',
            display: 'block',
            textAlign: isOwn ? 'right' : 'left',
            mt: 0.25,
            px: 1,
            fontSize: '0.65rem',
          }}
        >
          {formatTime(message.createdAt)}
        </Typography>
      </Box>
    </Box>
  );
}
