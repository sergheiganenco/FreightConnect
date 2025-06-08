// src/pages/shipper/ShipperDocuments.js
import React, { useEffect, useState } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, Button
} from "@mui/material";
import api from "../../services/api";

const statusColors = {
  Generated: "primary",
  Uploaded: "success",
  Pending: "warning",
};

export default function ShipperDocuments() {
  const [docs, setDocs] = useState([]);
  useEffect(() => {
    api.get('/shipper/documents')
      .then(res => setDocs(res.data || []))
      .catch(() => setDocs([]));
  }, []);
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>My Documents</Typography>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Load</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Download</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {docs.map(doc => (
              <TableRow key={doc._id}>
                <TableCell>{doc.type}</TableCell>
                <TableCell>{doc.loadId}</TableCell>
                <TableCell>
                  <Chip label={doc.status} color={statusColors[doc.status] || "default"} />
                </TableCell>
                <TableCell>{new Date(doc.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  {doc.url && <Button href={doc.url} target="_blank" size="small">View</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
