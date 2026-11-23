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
        height: { xs: 'calc(100dvh - 104px)', md: 'calc(100vh - 120px)' },
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Phones show one pane at a time: the list, or the open conversation (with a back button). */}
      <Box sx={{ display: { xs: activeChannelId ? 'none' : 'flex', md: 'flex' }, width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
        <ChatSidebar />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: { xs: activeChannelId ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
        <ChatWindow channelId={activeChannelId} />
      </Box>
    </Box>
  );
}
