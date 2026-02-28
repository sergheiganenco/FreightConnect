// src/pages/admin/AdminLoads.js

import React, { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  Grid,
  TextField,
  Select,
  MenuItem,
  InputAdornment,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";
import FilterListIcon from "@mui/icons-material/FilterList";
import api from "../../services/api";

const columns = [
  { id: "title", label: "Title", minWidth: 110 },
  { id: "shipper", label: "Shipper", minWidth: 90 },
  { id: "origin", label: "Origin", minWidth: 90 },
  { id: "destination", label: "Destination", minWidth: 90 },
  { id: "rate", label: "Amount ($)", minWidth: 80 },
  { id: "status", label: "Status", minWidth: 70 },
  { id: "createdAt", label: "Posted", minWidth: 80 },
  { id: "actions", label: "", minWidth: 32 }
];

const statusOptions = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Accepted", value: "accepted" },
  { label: "Delivered", value: "delivered" }
];

export default function AdminLoads() {
  const [loads, setLoads] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState(null);

  // Filters state
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // For controlling when to fetch
  const [filtersChanged, setFiltersChanged] = useState(false);

  // Fetch with filters
  const fetchLoads = async (pg = 0) => {
    setLoading(true);
    setError("");
    try {
      let params = [
        `page=${pg + 1}`,
        `limit=${rowsPerPage}`,
        "sortBy=createdAt",
        "sortOrder=desc",
      ];
      if (q.trim()) params.push(`q=${encodeURIComponent(q.trim())}`);
      if (status && status !== "all") params.push(`status=${status}`);
      if (minAmount) params.push(`minAmount=${minAmount}`);
      if (maxAmount) params.push(`maxAmount=${maxAmount}`);

      const url = `/admin/loads?${params.join("&")}`;
      const res = await api.get(url);

      if (Array.isArray(res.data.loads)) {
        setLoads(res.data.loads);
        setTotal(res.data.total || res.data.loads.length || 0);
      } else if (Array.isArray(res.data)) {
        setLoads(res.data);
        setTotal(res.data.length);
      } else {
        setLoads([]);
        setTotal(0);
      }
    } catch (err) {
      setError("Failed to load loads.");
      setLoads([]);
    }
    setLoading(false);
  };

  // Trigger fetch on filter change
  useEffect(() => {
    fetchLoads(page);
    // eslint-disable-next-line
  }, [page, filtersChanged]);

  const handleChangePage = (e, newPage) => {
    setPage(newPage);
  };

  const openModal = (load) => {
    setSelectedLoad(load);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedLoad(null);
  };

  // Unified filter apply
  const applyFilters = () => {
    setPage(0);
    setFiltersChanged(f => !f);
  };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Typography variant="h5" fontWeight={900} sx={{ mb: 2, color: "#fff" }}>
        All Loads
      </Typography>

      {/* Filters */}
      <Paper
        elevation={0}
        sx={{
          mb: 2,
          borderRadius: 4,
          background: "linear-gradient(90deg, #392a7cbb 0%, #b833eb55 100%)",
          display: "flex",
          gap: 2,
          p: 2,
          alignItems: "center"
        }}
      >
        {/* Search */}
        <TextField
          variant="filled"
          size="small"
          placeholder="Search Title, Origin, Destination"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyPress={e => { if (e.key === "Enter") applyFilters(); }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FilterListIcon sx={{ color: "#fff" }} />
              </InputAdornment>
            ),
            disableUnderline: true,
            sx: {
              bgcolor: "#24174c",
              borderRadius: 2,
              color: "#fff",
              input: { color: "#fff" }
            }
          }}
          sx={{ minWidth: 220, mr: 1 }}
        />

        {/* Status */}
        <Typography fontWeight={700} color="#b6b8f3" mr={0.5}>
          Status:
        </Typography>
        <Select
          value={status}
          onChange={e => { setStatus(e.target.value); applyFilters(); }}
          variant="filled"
          size="small"
          disableUnderline
          sx={{
            bgcolor: "#7a6bf5",
            color: "#fff",
            fontWeight: 700,
            borderRadius: 2,
            ".MuiSelect-icon": { color: "#fff" },
            minWidth: 110,
            mr: 1
          }}
        >
          {statusOptions.map(option =>
            <MenuItem
              key={option.value}
              value={option.value}
              sx={{
                bgcolor: "#251962 !important",
                color: "#fff !important"
              }}
            >
              {option.label}
            </MenuItem>
          )}
        </Select>

        {/* Min/Max */}
        <TextField
          variant="filled"
          size="small"
          placeholder="Min Amt"
          type="number"
          value={minAmount}
          onChange={e => setMinAmount(e.target.value)}
          onBlur={applyFilters}
          InputProps={{
            disableUnderline: true,
            sx: {
              bgcolor: "#24174c",
              borderRadius: 2,
              color: "#fff",
              input: { color: "#fff" }
            }
          }}
          sx={{ minWidth: 100, mr: 1 }}
        />
        <TextField
          variant="filled"
          size="small"
          placeholder="Max Amt"
          type="number"
          value={maxAmount}
          onChange={e => setMaxAmount(e.target.value)}
          onBlur={applyFilters}
          InputProps={{
            disableUnderline: true,
            sx: {
              bgcolor: "#24174c",
              borderRadius: 2,
              color: "#fff",
              input: { color: "#fff" }
            }
          }}
          sx={{ minWidth: 100 }}
        />

        {/* Apply btn for search (optional, enter key works too) */}
        <IconButton
          onClick={applyFilters}
          sx={{
            ml: 1,
            color: "#fff",
            bgcolor: "#f04ca7",
            borderRadius: "8px",
            "&:hover": { bgcolor: "#fa37ad" }
          }}
        >
          <FilterListIcon />
        </IconButton>
      </Paper>

      {/* Table */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 4,
          background: "rgba(124,140,248,0.14)",
          boxShadow: "0 4px 24px #1e034315",
          overflow: "hidden"
        }}
      >
        {loading ? (
          <Box p={8} display="flex" justifyContent="center" alignItems="center">
            <CircularProgress size={38} />
          </Box>
        ) : error ? (
          <Typography color="error" sx={{ p: 4 }}>{error}</Typography>
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
                          color: "#fff",
                          background: "rgba(34,25,84,0.36)",
                          borderBottom: "2.5px solid #a8a9f4",
                          fontSize: "1.1rem",
                          textShadow: "0 2px 6px rgba(0,0,0,0.20)",
                          letterSpacing: 0.6,
                          textTransform: "capitalize",
                        }}
                        align={col.align || "left"}
                        style={{ minWidth: col.minWidth }}
                      >
                        {col.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} align="center" sx={{ color: "#fff", py: 6 }}>
                        No loads found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    loads.map((load, idx) => (
                      <TableRow key={load._id || idx}
                        sx={{
                          background: idx % 2 ? "rgba(124,140,248,0.08)" : "rgba(255,255,255,0.02)"
                        }}
                      >
                        <TableCell sx={{ color: "#fff" }}>{load.title}</TableCell>
                        <TableCell sx={{ color: "#fff" }}>
                          {load.shipperName || (load.postedBy && load.postedBy.name) || "N/A"}
                        </TableCell>
                        <TableCell sx={{ color: "#fff" }}>{load.origin}</TableCell>
                        <TableCell sx={{ color: "#fff" }}>{load.destination}</TableCell>
                        <TableCell sx={{ color: "#fff" }}>
                          {load.rate ? `$${Number(load.rate).toLocaleString()}` : "N/A"}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={load.status?.toUpperCase() || "OPEN"}
                            size="small"
                            sx={{
                              bgcolor: load.status === "delivered"
                                ? "#34D399"
                                : load.status === "pending"
                                  ? "#F59E42"
                                  : "#6366f1",
                              color: "#fff",
                              fontWeight: 700,
                              px: 1.5
                            }}
                          />
                        </TableCell>
                        <TableCell sx={{ color: "#bcbcff" }}>
                          {load.createdAt ? new Date(load.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>
                          <Tooltip title="View Details">
                            <IconButton 
                                onClick={() => openModal(load)}
                                sx={{
                                  color: "#fff",
                                  bgcolor: "#f04ca7",
                                  borderRadius: "50%",
                                  p: 1.1,
                                  boxShadow: "0 2px 8px 0 #c959aa33",
                                  "&:hover": {
                                    bgcolor: "#fa37ad",
                                    color: "#fff",
                                    boxShadow: "0 2px 12px 0 #ff6cf033"
                                  },
                                  transition: "all 0.2s",
                                }}
                              >
                                <InfoOutlinedIcon sx={{ fontSize: 28, fontWeight: 900 }} />
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
              onPageChange={handleChangePage}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10]}
              sx={{
                ".MuiTablePagination-toolbar": {
                  color: "#6366f1"
                }
              }}
            />
          </>
        )}
      </Paper>

      {/* View Details Modal */}
      <Dialog open={modalOpen} onClose={closeModal} maxWidth="sm" fullWidth>
        <DialogTitle
          sx={{
            bgcolor: "#6342F5",
            color: "#fff",
            fontWeight: 800,
            letterSpacing: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          Load Details
          <IconButton onClick={closeModal} sx={{ color: "#fff" }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ bgcolor: "rgba(124,140,248,0.1)" }}>
          {selectedLoad && (
            <Grid container spacing={2} sx={{ p: 1 }}>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Title</Typography>
                <Typography sx={{ mb: 2 }}>{selectedLoad.title || "N/A"}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Status</Typography>
                <Chip
                  label={selectedLoad.status?.toUpperCase() || "OPEN"}
                  size="small"
                  sx={{
                    bgcolor: selectedLoad.status === "delivered"
                      ? "#34D399"
                      : selectedLoad.status === "pending"
                        ? "#F59E42"
                        : "#6366f1",
                    color: "#fff",
                    fontWeight: 700,
                    px: 1.5,
                    mb: 2
                  }}
                />
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Shipper</Typography>
                <Typography sx={{ mb: 2 }}>
                  {selectedLoad.shipperName || (selectedLoad.postedBy && selectedLoad.postedBy.name) || "N/A"}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Amount</Typography>
                <Typography sx={{ mb: 2 }}>
                  {selectedLoad.rate ? `$${Number(selectedLoad.rate).toLocaleString()}` : "N/A"}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Origin</Typography>
                <Typography sx={{ mb: 2 }}>{selectedLoad.origin || "N/A"}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Destination</Typography>
                <Typography sx={{ mb: 2 }}>{selectedLoad.destination || "N/A"}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Created</Typography>
                <Typography sx={{ mb: 2 }}>
                  {selectedLoad.createdAt ? new Date(selectedLoad.createdAt).toLocaleString() : "—"}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography fontWeight={700} color="#6366f1">Equipment Type</Typography>
                <Typography sx={{ mb: 2 }}>
                  {selectedLoad.equipmentType || "N/A"}
                </Typography>
              </Grid>
              <Grid item xs={12}>
                <Typography fontWeight={700} color="#6366f1">Description</Typography>
                <Typography sx={{ mb: 2 }}>
                  {selectedLoad.description || "No description provided."}
                </Typography>
              </Grid>
            </Grid>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
