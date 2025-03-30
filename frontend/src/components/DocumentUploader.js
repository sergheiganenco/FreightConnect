import React, { useState } from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';
import api from '../services/api';

const DocumentUploader = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadStatus('Please select a file first!');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadStatus('File uploaded successfully.');
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('Failed to upload file.');
    }
  };

  return (
    <Box sx={{ mt: 3, mb: 3, p: 2, border: '1px solid #ddd', borderRadius: '8px' }}>
      <Typography variant="h6">Upload Document</Typography>

      <input type="file" onChange={handleFileChange} style={{ margin: '10px 0' }} />

      <Button variant="contained" color="primary" onClick={handleUpload}>
        Upload
      </Button>

      {uploadStatus && (
        <Alert severity={uploadStatus.includes('successfully') ? 'success' : 'error'} sx={{ mt: 2 }}>
          {uploadStatus}
        </Alert>
      )}
    </Box>
  );
};

export default DocumentUploader;
