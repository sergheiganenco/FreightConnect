import React, { useState, useEffect, useCallback } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import {
  Box, IconButton, Typography, Paper, Button, TextField, CircularProgress
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import ChatIcon from '@mui/icons-material/Chat';
import api from '../services/api';
import LoadDetailsModal from './LoadDetailsModal';

const LogisticsAssistant = ({ onLoadAccepted }) => {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('awaiting-command');
  const [recommendedLoads, setRecommendedLoads] = useState([]);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [useText, setUseText] = useState(false);
  const [transcripts, setTranscripts] = useState([]);

  const { transcript, listening, resetTranscript } = useSpeechRecognition();

  const speakMessage = useCallback((message, listenAfter = true) => {
    window.speechSynthesis.cancel();
    SpeechRecognition.stopListening();

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;

    utterance.onend = () => {
      if (listenAfter && !useText) {
        SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [useText]);

  const startAssistant = () => {
    setActive(true);
    setUseText(false);
    resetTranscript();
    speakMessage("Voice assistant activated. How can I help?");
    setStatus('awaiting-command');
  };

  const stopAssistant = useCallback(() => {
    SpeechRecognition.stopListening();
    setActive(false);
    speakMessage("Voice assistant closed.", false);
    setStatus('idle');
  }, [speakMessage]);

  const fetchRecommendedLoads = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.post('/chatbot/voice-command', { command: 'recommend loads' }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { loads = [], message } = response.data;

      setRecommendedLoads(loads);

      if (loads.length > 0) {
        speakMessage(`${message}. Would you like to hear details of the first load?`);
        setStatus('awaiting-details-confirmation');
      } else {
        speakMessage("No recommended loads found. Anything else?");
        setStatus('awaiting-command');
      }
    } catch {
      speakMessage("Failed to fetch recommended loads.");
      setStatus('awaiting-command');
    } finally {
      setLoading(false);
    }
  }, [speakMessage]);

  const handleLoadDetails = useCallback((load) => {
    setSelectedLoad(load);
    const details = `Load: ${load.title}, from ${load.origin} to ${load.destination}, rate ${load.rate} dollars, equipment: ${load.equipmentType}. Do you want to accept this load?`;
    speakMessage(details);
    setStatus('awaiting-acceptance');
  }, [speakMessage]);

  const handleAcceptLoad = useCallback(async () => {
    if (!selectedLoad) return;

    try {
      await api.put(`/loads/${selectedLoad._id}/accept`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      speakMessage("Load accepted successfully. Do you want to close the assistant?");
      if (onLoadAccepted) onLoadAccepted(selectedLoad._id);
      setStatus('awaiting-assistant-close-confirmation');
    } catch {
      speakMessage("Error accepting the load. Please try again later.");
      setStatus('awaiting-command');
    }
  }, [selectedLoad, onLoadAccepted, speakMessage]);

  const processUserCommand = useCallback((command) => {
    command = command.toLowerCase().trim();
    setTranscripts(prev => [...prev, command]);

    if (status === 'awaiting-command') {
      if (command.includes('recommend loads')) {
        fetchRecommendedLoads();
      } else {
        speakMessage("I didn't understand. You can say, recommend loads.");
      }
    } else if (status === 'awaiting-details-confirmation') {
      if (['yes', 'details', 'sure'].some(w => command.includes(w))) {
        handleLoadDetails(recommendedLoads[0]);
      } else {
        speakMessage("Alright, details skipped. Anything else?");
        setStatus('awaiting-command');
      }
    } else if (status === 'awaiting-acceptance') {
      if (['yes', 'accept'].some(w => command.includes(w))) {
        handleAcceptLoad();
      } else if (['no', 'decline', 'do not', "don't"].some(w => command.includes(w))) {
        speakMessage("Load not accepted. Need anything else?");
        setSelectedLoad(null);
        setStatus('awaiting-command');
      } else {
        speakMessage("Sorry, didn't catch that. Do you want to accept?");
      }
    } else if (status === 'awaiting-assistant-close-confirmation') {
      if (['yes', 'close'].some(w => command.includes(w))) {
        stopAssistant();
      } else {
        speakMessage("Assistant remains open. How else may I help?");
        setStatus('awaiting-command');
      }
    }
  }, [status, fetchRecommendedLoads, handleLoadDetails, handleAcceptLoad, speakMessage, recommendedLoads, stopAssistant]);

  useEffect(() => {
    if (transcript && active && !useText) {
      processUserCommand(transcript);
      resetTranscript();
    }
  }, [transcript, active, processUserCommand, resetTranscript, useText]);

  return (
    <Box sx={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}>
      <IconButton color="primary" onClick={startAssistant} sx={{ bgcolor: 'primary.main', color: 'white', width: 60, height: 60, boxShadow: 3 }}>
        {useText ? <ChatIcon /> : <MicIcon />}
      </IconButton>

      {active && (
        <Paper sx={{ p: 2, mt: 2, width: 400 }}>
          <Typography variant="h6">Assistant ({listening ? 'Listening...' : 'Waiting...'})</Typography>
          {loading && <CircularProgress size={20} />}
          <Button color="secondary" variant="contained" sx={{ mt: 2 }} onClick={stopAssistant}>Close Assistant</Button>
        </Paper>
      )}

      {selectedLoad && (
        <LoadDetailsModal load={selectedLoad} userRole="carrier" onClose={() => setSelectedLoad(null)} onLoadAccepted={handleAcceptLoad} />
      )}
    </Box>
  );
};

export default LogisticsAssistant;
