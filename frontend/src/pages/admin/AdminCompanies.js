// src/pages/admin/AdminCompanies.js
import React, { useEffect, useState, useRef } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, CircularProgress, IconButton,
  Tooltip, Dialog, DialogTitle, DialogContent, Grid, Chip, TextField, InputAdornment
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import api from "../../services/api";
import { brand, semantic, surface, text as T, status as ST } from '../../theme/tokens';

const columns = [
  { id: "name", label: "Company", minWidth: 120 },
  { id: "dotNumber", label: "DOT #", minWidth: 90 },
  { id: "type", label: "Type", minWidth: 80 },
  { id: "fleetSize", label: "Fleet", minWidth: 70 },
  { id: "status", label: "Status", minWidth: 70 },
  { id: "createdAt", label: "Joined", minWidth: 100 },
  { id: "actions", label: "", minWidth: 32 }
];

export default function AdminCompanies() {
  const [companies, setCompanies] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Ref for polling interval
  const pollingRef = useRef(null);

  // Fetch companies with pagination/search
  const fetchCompanies = async (pg = 0, searchValue = "") => {
    setLoading(true);
    try {
      const res = await api.get(
        `/admin/companies?page=${pg + 1}&limit=${rowsPerPage}&search=${searchValue}`
      );
      setCompanies(res.data.companies);
      setTotal(res.data.total);
    } catch (err) {
      setCompanies([]);
      setTotal(0);
    }
    setLoading(false);
  };

  // Polling: Fetch on mount and every 10s
  useEffect(() => {
    fetchCompanies(page, search);
    pollingRef.current = setInterval(() => {
      fetchCompanies(page, search);
    }, 10000);
    return () => clearInterval(pollingRef.current);
    // eslint-disable-next-line
  }, [page, search]);

  // Debounced search (optional, can be instant)
  const handleSearch = (e) => {
    setSearch(e.target.value);
    setPage(0);
    fetchCompanies(0, e.target.value);
  };

  // Open modal and fetch full company details
  const openModal = async (company) => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/fleet/companies/${company._id}`);
      setSelectedCompany(res.data);
      setModalOpen(true);
    } finally {
      setLoading(false);
    }
  };

  // Close modal and refresh companies immediately
  const closeModal = () => {
    setModalOpen(false);
    setSelectedCompany(null);
    fetchCompanies(page, search); // Immediate refresh on close
  };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Typography variant="h5" fontWeight={900} sx={{ mb: 2, color: T.primary }}>
        Companies & Fleets
      </Typography>

      {/* Filter/Search */}
      <Paper elevation={0} sx={{ mb: 2, p: 1.5, background: surface.indigoTint, borderRadius: 3 }}>
        <TextField
          variant="outlined"
          placeholder="Search companies..."
          value={search}
          onChange={handleSearch}
          InputProps={{
            sx: { bgcolor: surface.appBar, color: T.primary, borderRadius: 2 },
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: brand.pink }} />
              </InputAdornment>
            ),
          }}
          size="small"
          fullWidth
        />
      </Paper>

      {/* Table */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 4,
          background: surface.indigoTint,
          boxShadow: "0 4px 24px #1e034315",
          overflow: "hidden"
        }}
      >
        {loading ? (
          <Box p={8} display="flex" justifyContent="center" alignItems="center">
            <CircularProgress size={38} />
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    {columns.map(col => (
                      <TableCell
                        key={col.id}
                        sx={{
                          fontWeight: 900,
                          color: T.primary,
                          background: surface.appBar,
                          borderBottom: `2.5px solid ${brand.indigoLight}`,
                          fontSize: "1.08rem",
                          textTransform: "capitalize"
                        }}
                        style={{ minWidth: col.minWidth }}
                      >
                        {col.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {companies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} align="center" sx={{ color: T.primary, py: 6 }}>
                        No companies found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    companies.map((company, idx) => (
                      <TableRow key={company._id || idx}
                        sx={{
                          background: idx % 2 ? surface.indigoTintLight : surface.glassSubtle
                        }}
                      >
                        <TableCell sx={{ color: T.primary }}>{company.name}</TableCell>
                        <TableCell sx={{ color: T.primary }}>{company.dotNumber || "—"}</TableCell>
                        <TableCell sx={{ color: T.primary }}>{company.type || "—"}</TableCell>
                        <TableCell sx={{ color: T.primary }}>{company.fleetSize || "—"}</TableCell>
                        <TableCell>
                          <Chip
                            label={company.status?.toUpperCase() || "ACTIVE"}
                            size="small"
                            sx={{
                              bgcolor: company.status === "suspended"
                                ? semantic.error
                                : brand.indigo,
                              color: T.primary,
                              fontWeight: 700,
                              px: 1.5
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ color: brand.softIndigo }}>
                          {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          <Tooltip title="View Details">
                            <IconButton
                              onClick={() => openModal(company)}
                              sx={{
                                color: T.primary,
                                bgcolor: brand.pink,
                                borderRadius: "50%",
                                p: 1.1,
                                boxShadow: "0 2px 8px 0 #c959aa33",
                                "&:hover": {
                                  bgcolor: "#fa37ad",
                                  color: T.primary,
                                  boxShadow: "0 2px 12px 0 #ff6cf033"
                                },
                                transition: "all 0.2s"
                              }}
                            >
                              <InfoOutlinedIcon sx={{ fontSize: 24, fontWeight: 900 }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(e, np) => setPage(np)}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10]}
              sx={{
                ".MuiTablePagination-toolbar": {
                  color: brand.indigo
                }
              }}
            />
          </>
        )}
      </Paper>

      {/* Details Modal */}
      <Dialog open={modalOpen} onClose={closeModal} maxWidth="md" fullWidth>
        <DialogTitle
          sx={{
            bgcolor: brand.primary,
            color: T.primary,
            fontWeight: 800,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          Company & Fleet Details
          <IconButton onClick={closeModal} sx={{ color: T.primary }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ bgcolor: surface.indigoTint }}>
          {selectedCompany && (
            <Grid container spacing={2} sx={{ p: 1 }}>
              <Grid item xs={12} md={4}>
                <Typography fontWeight={700} color={brand.indigo}>Company</Typography>
                <Typography sx={{ mb: 2 }}>{selectedCompany.company.name}</Typography>
                <Typography color={brand.indigo} fontWeight={600}>DOT/MC: </Typography>
                <Typography sx={{ mb: 1 }}>{selectedCompany.company.dotNumber || "—"} / {selectedCompany.company.mcNumber || "—"}</Typography>
                <Typography color={brand.indigo} fontWeight={600}>Type: </Typography>
                <Typography sx={{ mb: 2 }}>{selectedCompany.company.type || "—"}</Typography>
                <Typography color={brand.indigo} fontWeight={600}>Status: </Typography>
                <Chip label={selectedCompany.company.status?.toUpperCase()} size="small"
                  sx={{ bgcolor: selectedCompany.company.status === "suspended" ? semantic.error : brand.indigo, color: T.primary, fontWeight: 700, px: 1.5, mb: 2 }} />
                <Typography color={brand.indigo} fontWeight={600}>Joined:</Typography>
                <Typography>{selectedCompany.company.createdAt ? new Date(selectedCompany.company.createdAt).toLocaleString() : "—"}</Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography fontWeight={700} color={brand.indigo}>Fleet (Trucks)</Typography>
                {selectedCompany.trucks.length === 0 ? (
                  <Typography>No trucks registered.</Typography>
                ) : (
                  selectedCompany.trucks.map(truck => (
                    <Box key={truck._id} sx={{ mb: 1, borderBottom: `1px solid ${surface.glassBorder}`, pb: 1 }}>
                      <Typography>Plate: <b>{truck.plate}</b> — {truck.type}, {truck.status}</Typography>
                      <Typography variant="body2" color="textSecondary">Assigned Driver: {truck.assignedDriver || "—"}</Typography>
                    </Box>
                  ))
                )}
              </Grid>
              <Grid item xs={12} md={4}>
                <Typography fontWeight={700} color={brand.indigo}>Drivers/Users</Typography>
                {selectedCompany.drivers.length === 0 ? (
                  <Typography>No users/drivers.</Typography>
                ) : (
                  selectedCompany.drivers.map(driver => (
                    <Box key={driver._id} sx={{ mb: 1, borderBottom: `1px solid ${surface.glassBorder}`, pb: 1 }}>
                      <Typography>{driver.name || driver.email}</Typography>
                      <Typography variant="body2" color="textSecondary">{driver.role || "driver"}</Typography>
                    </Box>
                  ))
                )}
              </Grid>
            </Grid>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
