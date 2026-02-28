import React, { useEffect, useState } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TablePagination, CircularProgress, Chip, Stack
} from "@mui/material";
import api from '../../services/api';

export default function LoadsSection() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    api.get("/admin/loads")
      .then(res => setLoads(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box textAlign="center" pt={6}><CircularProgress /></Box>;

  return (
    <Paper sx={{ mt: 3, borderRadius: 4, px: 2, pt: 2, pb: 0 }}>
      <Typography variant="h6" fontWeight={700} mb={2}>All Loads</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Origin</TableCell>
              <TableCell>Destination</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Carrier</TableCell>
              <TableCell>Shipper</TableCell>
              <TableCell>Flagged</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loads.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map(load => (
              <TableRow key={load._id}>
                <TableCell>
                  <Chip label={load.status} color={
                    load.status === "pending-docs" ? "warning" :
                    load.status === "live" ? "success" :
                    load.status === "completed" ? "primary" : "default"
                  } />
                </TableCell>
                <TableCell>{load.origin}</TableCell>
                <TableCell>{load.destination}</TableCell>
                <TableCell>${load.price}</TableCell>
                <TableCell>{load.carrierName || "-"}</TableCell>
                <TableCell>{load.shipperName || "-"}</TableCell>
                <TableCell>
                  {load.flagged ? <Chip label="Flagged" color="error" /> : ""}
                </TableCell>
                <TableCell>{new Date(load.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        count={loads.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={e => { setRowsPerPage(+e.target.value); setPage(0); }}
        rowsPerPageOptions={[5, 10, 20]}
      />
    </Paper>
  );
}
