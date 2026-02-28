import React from 'react';
import { Box } from '@mui/material';
import ChatSidebar from './ChatSidebar';
import ChatWindow from './ChatWindow';
import { useChatContext } from './ChatProvider';

export default function ChatPage() {
  const { activeChannelId } = useChatContext();

  return (
    <Box
      sx={{
        display: 'flex',
        height: 'calc(100vh - 120px)',
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <ChatSidebar />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ChatWindow channelId={activeChannelId} />
      </Box>
    </Box>
  );
}
