import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Paper, Chip, Stack, Pagination, FormControl,
  InputLabel, Select, MenuItem, Dialog, DialogContent, IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import api from "../../services/api";
import DocumentRow from "../../features/shared/DocumentRow";

const FILTER_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Accepted", value: "accepted" },
  { label: "In-Transit", value: "in-transit" },
  { label: "Delivered", value: "delivered" },
];

const PAGE_SIZE = 3;

function PDFPreview({ open, url, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#111" }}>
        <IconButton onClick={onClose} sx={{ position: "absolute", top: 10, right: 10, zIndex: 2, color: "#fff" }}>
          <CloseIcon />
        </IconButton>
        <embed src={url} width="100%" height="700px" type="application/pdf" style={{ background: "#fff" }} />
      </DialogContent>
    </Dialog>
  );
}

export default function ShipperDocuments() {
  const [loads, setLoads] = useState([]);
  const [docMap, setDocMap] = useState({});
  const [preview, setPreview] = useState({ open: false, url: "" });
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get("/loads/shipper-my-loads")
      .then(({ data }) => {
        // Only show loads that have been accepted (have documents to show)
        const relevant = data.filter(l => ['accepted', 'in-transit', 'delivered'].includes(l.status));
        const sorted = [...relevant].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
        setLoads(sorted);
      })
      .catch((err) => console.error("Fetch loads failed:", err));
  }, []);

  const fetchDocs = useCallback(async (loadId) => {
    try {
      const { data } = await api.get(`/documents/load/${loadId}`);
      setDocMap(prev => ({ ...prev, [loadId]: data.docs || {} }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loads.forEach(l => fetchDocs(l._id));
  }, [loads, fetchDocs]);

  const filtered = loads.filter(l => filter === "all" || l.status?.toLowerCase() === filter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [filter]);

  const openPreview = (url) => setPreview({ open: true, url });

  return (
    <Box sx={{ py: 3, px: { xs: 0, sm: 2, md: 6 }, width: "100%" }}>
      <Typography variant="h4" color="#fff" fontWeight={900} mb={3} sx={{ letterSpacing: 1 }}>
        Shipper Documents
      </Typography>
      <Stack direction="row" justifyContent="flex-end" mb={3}>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ color: "#fff" }}>Status</InputLabel>
          <Select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            label="Status"
            sx={{ bgcolor: "#4c318f", color: "#fff", borderRadius: 2, "& .MuiSvgIcon-root": { color: "#fff" } }}
          >
            {FILTER_OPTIONS.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <Box>
        {paged.length === 0 && (
          <Typography color="text.secondary" textAlign="center" mt={4}>
            No accepted loads found. Documents appear here once a carrier accepts your load.
          </Typography>
        )}
        {paged.map(load => {
          const docs = docMap[load._id] || {};
          const docFields = [
            {
              key: "ratecon",
              label: "Rate Confirmation",
              url: docs.rateConfirmation?.url,
              onClick: docs.rateConfirmation?.url ? () => openPreview(docs.rateConfirmation.url) : null,
            },
            {
              key: "bol",
              label: "BOL",
              url: docs.bol?.url,
              onClick: docs.bol?.url ? () => openPreview(docs.bol.url) : null,
            },
            {
              key: "pod",
              label: "POD",
              url: docs.pod?.url,
              onClick: docs.pod?.url ? () => openPreview(docs.pod.url) : null,
            },
          ];

          return (
            <Paper
              key={load._id}
              elevation={10}
              sx={{
                background: "linear-gradient(135deg,#7c3aed 55%,#312e81 100%)",
                borderRadius: 6,
                px: { xs: 1, sm: 5 },
                py: { xs: 2, sm: 2.5 },
                mb: 4,
                boxShadow: "0 8px 36px 0 #1e034320",
              }}
            >
              {/* Header */}
              <Box
                display="flex"
                flexDirection={{ xs: "column", sm: "row" }}
                alignItems={{ xs: "flex-start", sm: "center" }}
                justifyContent="space-between"
                gap={2}
                mb={2}
              >
                <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                  <Typography fontWeight={900} color="#fff" fontSize={{ xs: "1.18rem", sm: "1.22rem" }}>
                    {load.origin} → {load.destination}
                  </Typography>
                  <Chip
                    label={`$${load.rate?.toLocaleString()}`}
                    sx={{ bgcolor: "#a78bfa", color: "#fff", fontWeight: 800, fontSize: "1.1em" }}
                  />
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={load.status}
                    sx={{ bgcolor: "#818CF8", color: "#fff", fontWeight: 700, px: 2, fontSize: "1em" }}
                  />
                  <IconButton size="small" onClick={() => fetchDocs(load._id)} title="Refresh">
                    <RefreshIcon sx={{ color: "#fff", fontSize: 18 }} />
                  </IconButton>
                </Stack>
              </Box>

              {/* Doc grid — shippers can only view, not generate */}
              <Box sx={{
                bgcolor: "rgba(124,140,248,0.19)", borderRadius: 4,
                px: { xs: 1, sm: 3 }, py: 2, display: "flex", flexDirection: "column", gap: 2,
                boxShadow: "0 2px 12px 0 #4f46e520",
                backdropFilter: "blur(10px)",
                border: "1.5px solid rgba(124,140,248,0.25)"
              }}>
                {docFields.map(doc => (
                  <DocumentRow
                    key={doc.key}
                    doc={{ label: doc.label, url: doc.url }}
                    status={doc.url ? "Uploaded" : "Missing"}
                    loading={false}
                    onClick={doc.onClick}
                    onUpload={() => {}}
                    route={`${load.origin} → ${load.destination}`}
                    isUpload={false}
                    canGenerate={false}
                    fileType="pdf"
                  />
                ))}
              </Box>
            </Paper>
          );
        })}
      </Box>

      <Stack direction="row" justifyContent="center" mt={4}>
        {totalPages > 1 && (
          <Pagination
            count={totalPages}
            color="secondary"
            page={page}
            onChange={(_, val) => setPage(val)}
            sx={{
              "& .MuiPaginationItem-root": {
                bgcolor: "#4c318f", color: "#fff", borderRadius: 2, fontWeight: 700,
                "&.Mui-selected": { bgcolor: "#3ec17c", color: "#fff" }
              }
            }}
          />
        )}
      </Stack>

      <PDFPreview open={preview.open} url={preview.url} onClose={() => setPreview({ open: false, url: "" })} />
    </Box>
  );
}
