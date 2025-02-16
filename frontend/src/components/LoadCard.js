import React from 'react';
import { Card, CardContent, Typography, Button } from '@mui/material';

function LoadCard({ load, onViewDetails }) {
    return (
      <Card sx={{ mb: 2, p: 2 }}>
        <CardContent>
          <Typography variant="h6"><strong>{load.title}</strong></Typography>
          <Typography><strong>Origin:</strong> {load.origin}</Typography>
          <Typography><strong>Destination:</strong> {load.destination}</Typography>
          <Typography><strong>Rate:</strong> ${load.rate}</Typography>
          <Typography><strong>Status:</strong> {load.status}</Typography>

          <Button 
            variant="contained" 
            color="primary" 
            sx={{ mt: 1 }} 
            onClick={onViewDetails}
          >
            View Details
          </Button>
        </CardContent>
      </Card>
    );
}

export default LoadCard;
