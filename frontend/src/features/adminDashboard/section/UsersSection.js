import React, { useEffect, useState } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  TablePagination, Chip, CircularProgress, Stack
} from "@mui/material";
import api from '../../services/api';

export default function UsersSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    api.get("/admin/users")
      .then(res => setUsers(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box textAlign="center" pt={6}><CircularProgress /></Box>;

  return (
    <Paper sx={{ mt: 3, borderRadius: 4, px: 2, pt: 2, pb: 0 }}>
      <Typography variant="h6" fontWeight={700} mb={2}>User Management</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Company</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map(user => (
              <TableRow key={user._id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Chip label={user.role.toUpperCase()} color={
                    user.role === "admin" ? "secondary" :
                    user.role === "carrier" ? "primary" : "default"
                  } />
                </TableCell>
                <TableCell>{user.companyName || "-"}</TableCell>
                <TableCell>{user.phone || "-"}</TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        count={users.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={e => { setRowsPerPage(+e.target.value); setPage(0); }}
        rowsPerPageOptions={[5, 10, 20]}
      />
    </Paper>
  );
}
