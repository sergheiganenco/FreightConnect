import React, { useState, useEffect } from 'react';
import { Box, Button, Paper, Typography, Grid, CircularProgress } from '@mui/material';
import api from '../services/api';

const DocumentsPage = () => {
  const [loads, setLoads] = useState([]);
  const [generatedFiles, setGeneratedFiles] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLoadsAndFiles = async () => {
      setLoading(true);

      try {
        const res = await api.get('/loads/my-loads');
        const acceptedLoads = res.data.filter(load => load.status === 'accepted');
        setLoads(acceptedLoads);

        const filesState = {};
        await Promise.all(
          acceptedLoads.map(async (load) => {
            const pdfName = `${load._id}-bol.pdf`;
            const invoiceName = `${load._id}-invoice.pdf`;

            const pdfPath = `/documents/uploads/${pdfName}`;
            const invoicePath = `/documents/uploads/${invoiceName}`;

            const [pdfExists, invoiceExists] = await Promise.all([
              checkFileExists(pdfPath),
              checkFileExists(invoicePath),
            ]);

            filesState[load._id] = {
              pdf: pdfExists ? pdfPath : null,
              invoice: invoiceExists ? invoicePath : null,
            };
          })
        );

        setGeneratedFiles(filesState);
      } catch (err) {
        console.error('Error fetching loads:', err);
      }

      setLoading(false);
    };

    const checkFileExists = async (path) => {
      try {
        const fullUrl = `${process.env.REACT_APP_API_URL.replace(/\/api$/, '')}${path}`;
        const res = await fetch(fullUrl, { method: 'HEAD' });
        return res.ok;
      } catch {
        return false;
      }
    };

    fetchLoadsAndFiles();
  }, []);

  const generateDocument = async (loadId, type) => {
    const route = type === 'pdf'
      ? '/documents/generate-pdf'
      : `/documents/generate-invoice/${loadId}`;

    const method = type === 'pdf' ? 'post' : 'get';
    const payload = type === 'pdf' ? { loadId } : {};

    try {
      const res = await api[method](route, payload);

      if (res && res.data && res.data.filePath) {
        setGeneratedFiles(prev => ({
          ...prev,
          [loadId]: {
            ...prev[loadId],
            [type]: res.data.filePath,
          },
        }));
      } else {
        alert('Unexpected response from server.');
      }
    } catch (err) {
      if (err.response) {
        alert(`Server Error: ${err.response.data.error || err.response.data.message}`);
        console.error('Server error:', err.response.data);
      } else {
        alert('Server unreachable or unexpected error.');
        console.error('Network error:', err);
      }
    }
  };

  const viewDocument = async (filePath) => {
    if (!filePath) return alert('File not generated yet.');
  
    // Build the full URL manually (NOT using api.get)
    const fullUrl = filePath.startsWith('http')
      ? filePath
      : `${process.env.REACT_APP_API_URL.replace(/\/api$/, '')}${filePath}`;
  
    try {
      const res = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
  
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || 'File not found');
      }
  
      const blob = await res.blob();
      const fileURL = URL.createObjectURL(blob);
      window.open(fileURL, '_blank');
    } catch (err) {
      console.error('Error fetching document:', err);
      alert('Error fetching document.');
    }
  };
  

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      await api.post('/documents/upload', formData);
      alert('File uploaded successfully');
    } catch (err) {
      console.error('Upload failed:', err);
      alert('File upload failed.');
    }

    e.target.value = '';
  };

  if (loading) return <CircularProgress />;

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>Generate Documents</Typography>

      {loads.map(load => (
        <Box key={load._id} sx={{ my: 3 }}>
          <Typography variant="body1" gutterBottom>
            Load: {load.origin} → {load.destination} (${load.rate})
          </Typography>
          <Grid container spacing={2} alignItems="center">
            <Grid item>
              <Button variant="contained" onClick={() => generateDocument(load._id, 'pdf')}>
                {generatedFiles[load._id]?.pdf ? 'Regenerate BOL' : 'Generate BOL'}
              </Button>
            </Grid>
            <Grid item>
              <Button variant="outlined" onClick={() => viewDocument(generatedFiles[load._id]?.pdf)}>
                View BOL
              </Button>
            </Grid>
            <Grid item>
              <Button variant="contained" onClick={() => generateDocument(load._id, 'invoice')}>
                {generatedFiles[load._id]?.invoice ? 'Regenerate Invoice' : 'Generate Invoice'}
              </Button>
            </Grid>
            <Grid item>
              <Button variant="outlined" onClick={() => viewDocument(generatedFiles[load._id]?.invoice)}>
                View Invoice
              </Button>
            </Grid>
          </Grid>
        </Box>
      ))}

      <Typography variant="h5" sx={{ mt: 4 }} gutterBottom>Upload Documents</Typography>
      <input type="file" id="upload" hidden onChange={handleFileUpload} />
      <Button variant="outlined" component="label" htmlFor="upload">
        Upload Document
      </Button>
    </Paper>
  );
};

export default DocumentsPage;
