import React from "react";
import { Card, CardContent, Typography, Button } from "@mui/material";

function ShipperLoadCard({ load, userRole, onViewDetails, onAcceptLoad }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">
          <strong>{load.title}</strong>
        </Typography>
        <Typography>
          <strong>Origin:</strong> {load.origin}
        </Typography>
        <Typography>
          <strong>Destination:</strong> {load.destination}
        </Typography>
        <Typography>
          <strong>Rate:</strong> ${load.rate}
        </Typography>
        <Typography>
          <strong>Status:</strong> {load.status}
        </Typography>

        {/* For Shipper: No "Accept Load" button */}
        {/* For Carrier: Show "Accept Load" if status === 'open' */}
        {userRole === "carrier" && load.status === "open" && (
          <Button
            variant="contained"
            color="primary"
            sx={{ mt: 2, mr: 2 }}
            onClick={() => onAcceptLoad(load)}
          >
            Accept Load
          </Button>
        )}

        <Button
          variant="contained"
          color="secondary"
          sx={{ mt: 2 }}
          onClick={() => onViewDetails(load)}
        >
          View Details
        </Button>
      </CardContent>
    </Card>
  );
}

export default ShipperLoadCard;
