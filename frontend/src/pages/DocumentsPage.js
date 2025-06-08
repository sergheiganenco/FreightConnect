import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Grid,
  Chip,
  CircularProgress,
  Stack,
  Divider,
  Tooltip,
  Fade,
  Dialog,
  DialogContent,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Pagination,
  useTheme
} from "@mui/material";
import UploadIcon from "@mui/icons-material/CloudUpload";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DescriptionIcon from "@mui/icons-material/Description";
import CloseIcon from "@mui/icons-material/Close";
import api from "../services/api";

const PURPLE = "#722ED1";
const PURPLE_GRADIENT = "linear-gradient(120deg,#722ED1 30%,#3EC17C 100%)";
const CARD_BG_GRADIENT = "linear-gradient(135deg,#8034e6bb 60%,#2f2764cc 100%)";
const POD_GREEN = "#3EC17C";
const STATUS_MAP = {
  accepted: "#3EC17C",
  "in-transit": "#4D96FF",
  delivered: "#FFC107",
  pending: "#8884FF"
};
const FILTER_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Accepted", value: "accepted" },
  { label: "In-Transit", value: "in-transit" },
  { label: "Delivered", value: "delivered" },
  { label: "Pending", value: "pending" }
];
const PAGE_SIZE = 6;

function PDFPreview({ open, url, onClose }) {
  const [loadError, setLoadError] = useState(false);
  useEffect(() => setLoadError(false), [url, open]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent sx={{ p: 0, position: "relative", bgcolor: "rgba(0,0,0,0.04)" }}>
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", top: 12, right: 12, zIndex: 2, color: PURPLE, bgcolor: "#fff8", boxShadow: 1 }}
        >
          <CloseIcon />
        </IconButton>
        {!loadError ? (
          <embed
            src={url}
            width="100%"
            height="700px"
            type="application/pdf"
            onError={() => setLoadError(true)}
            style={{ borderRadius: 16, marginTop: 8, background: "#fff" }}
          />
        ) : (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 450,
              p: 4,
            }}
          >
            <Typography variant="h6" color="error" gutterBottom>
              Failed to load PDF file.
            </Typography>
            <Button
              variant="outlined"
              color="primary"
              onClick={() => window.open(url, "_blank")}
              sx={{ mt: 2 }}
            >
              Open PDF in New Tab
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentsPage() {
  const [loads, setLoads] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [busy, setBusy] = useState({});
  const [preview, setPreview] = useState({ open: false, url: "" });
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Fetch & sort by most recent
  useEffect(() => {
    api
      .get("/loads/my-loads")
      .then(({ data }) => {
        const sorted = [...data].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        setLoads(sorted);
      })
      .catch((err) => console.error("Failed to fetch loads:", err));
  }, []);

  // Filtered loads for display
  const filteredLoads = loads.filter(load =>
    filter === "all" ? true : load.status?.toLowerCase() === filter
  );

  // Pagination logic
  const totalPages = Math.ceil(filteredLoads.length / PAGE_SIZE);
  const pagedLoads = filteredLoads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Always go back to page 1 on filter change
  useEffect(() => { setPage(1); }, [filter]);

  // Check file existence
  const checkFiles = useCallback(
    async (loadId, attempt = 0) => {
      const BASE_URL = "http://localhost:5000";
      const paths = {
        bol: `${BASE_URL}/documents/uploads/${loadId}-bol.pdf`,
        invoice: `${BASE_URL}/documents/uploads/${loadId}-invoice.pdf`,
        pod: `${BASE_URL}/documents/uploads/${loadId}-pod.pdf`,
      };
      const check = async (p) => {
        try {
          const res = await fetch(p, { method: 'HEAD' });
          return res.ok;
        } catch {
          return false;
        }
      };
      const [bol, invoice, pod] = await Promise.all([
        check(paths.bol),
        check(paths.invoice),
        check(paths.pod),
      ]);
      setStatusMap((prev) => ({
        ...prev,
        [loadId]: {
          bol: bol ? paths.bol : null,
          invoice: invoice ? paths.invoice : null,
          pod: pod ? paths.pod : null,
        },
      }));
      if ((busy[loadId] === "bol" && !bol) || (busy[loadId] === "invoice" && !invoice)) {
        if (attempt < 5) setTimeout(() => checkFiles(loadId, attempt + 1), 1500);
      }
    },
    [busy]
  );
  useEffect(() => {
    loads.forEach((load) => checkFiles(load._id));
  }, [loads, checkFiles]);

  // --- ACTIONS (unchanged) ---
  const handleGenerateBOL = async (loadId) => {
    setBusy((b) => ({ ...b, [loadId]: "bol" }));
    try {
      await api.post("/documents/generate-bol", { loadId });
      setTimeout(() => checkFiles(loadId), 1800);
    } catch {
      alert("BOL generation failed");
    } finally {
      setBusy((b) => ({ ...b, [loadId]: null }));
    }
  };
  const handleGenerateInvoice = async (loadId) => {
    setBusy((b) => ({ ...b, [loadId]: "invoice" }));
    try {
      await api.post("/documents/generate-invoice", { loadId });
      setTimeout(() => checkFiles(loadId), 1800);
    } catch {
      alert("Invoice generation failed");
    } finally {
      setBusy((b) => ({ ...b, [loadId]: null }));
    }
  };
  const handleUploadPOD = async (loadId, file) => {
    setBusy((b) => ({ ...b, [loadId]: "pod" }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/documents/upload-pod/${loadId}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setTimeout(() => checkFiles(loadId), 1100);
    } catch {
      alert("POD upload failed");
    } finally {
      setBusy((b) => ({ ...b, [loadId]: null }));
    }
  };
  const openPreview = (url) => setPreview({ open: true, url });

  // --- RENDER ---
  return (
    <Box sx={{
      py: { xs: 1, md: 3 },
      px: { xs: 0, md: 0 },
      minHeight: "100vh",
      width: "100%",
      background: "none",
    }}>
      <Typography
        variant="h4"
        align="center"
        sx={{
          color: "#fff",
          fontWeight: 900,
          mb: 2,
          letterSpacing: 0.5,
          textShadow: "0 2px 16px rgba(80,30,140,0.10)",
        }}
      >
        Documents
      </Typography>
      {/* Filter control */}
      <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ mb: 2, pr: { xs: 1, md: 5 } }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel sx={{ color: "#fff" }}>Status</InputLabel>
          <Select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            sx={{
              bgcolor: "#4c318f", color: "#fff",
              "& .MuiSvgIcon-root": { color: "#fff" },
              borderRadius: 2
            }}
            label="Status"
          >
            {FILTER_OPTIONS.map(opt =>
              <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
            )}
          </Select>
        </FormControl>
      </Stack>
      {/* Card Grid */}
      <Grid
        container
        spacing={{ xs: 2, sm: 3, md: 4 }}
        sx={{
          justifyContent: "center",
          mx: 0,
          width: "100%",
        }}
      >
        {pagedLoads.map((load) => {
          const st = statusMap[load._id] || {};
          const statusColor = STATUS_MAP[load.status?.toLowerCase()] || "#8884FF";
          return (
            <Grid
              key={load._id}
              item
              xs={12}
              sm={6}
              md={4}
              lg={3}
              sx={{
                display: "flex",
                justifyContent: "center",
                minWidth: 275,
                maxWidth: 375,
              }}
            >
              <Fade in timeout={600}>
                <Card
                  sx={{
                    flex: 1,
                    minWidth: 265,
                    maxWidth: 355,
                    bgcolor: CARD_BG_GRADIENT,
                    borderRadius: 5,
                    border: "2.5px solid #a488f633",
                    boxShadow: "0 8px 32px 0 rgba(75,30,120,0.12)",
                    transition: "box-shadow 0.3s, border 0.3s, transform 0.3s",
                    "&:hover": {
                      boxShadow: "0 16px 48px 0 rgba(75,30,120,0.18)",
                      border: `2.5px solid #7b2ff2aa`,
                      transform: "translateY(-2px) scale(1.013)",
                    },
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    justifyContent: "flex-start",
                  }}
                  elevation={0}
                >
                  {/* Header chips */}
                  <Stack direction="row" spacing={1} sx={{ px: 2, pt: 2, mb: 0.5 }}>
                    {load.title && (
                      <Chip
                        label={load.title}
                        sx={{
                          bgcolor: "#9e7ad1",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: "0.89em",
                          px: 1,
                          textTransform: "capitalize",
                          letterSpacing: 0.4,
                        }}
                        size="small"
                      />
                    )}
                    <Chip
                      label={load.status?.replace("-", " ") || "Status"}
                      sx={{
                        bgcolor: statusColor,
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: "0.89em",
                        px: 1.1,
                        letterSpacing: 0.2,
                        textTransform: "capitalize"
                      }}
                      size="small"
                    />
                  </Stack>
                  <CardContent sx={{
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    px: 2, pt: 1, pb: 2
                  }}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "#fff",
                        fontWeight: 600,
                        opacity: 0.94,
                        fontSize: "0.99em",
                        mb: 0.4,
                        letterSpacing: 0.01
                      }}
                    >
                      {load.origin} → {load.destination}
                    </Typography>
                    <Chip
                      label={`$${load.rate}`}
                      sx={{
                        bgcolor: "#6f43b7",
                        color: "#fff",
                        fontWeight: 900,
                        fontSize: "1.13em",
                        letterSpacing: 0.2,
                        px: 2,
                        py: 0.6,
                        my: 1.1,
                        borderRadius: 1.5,
                        boxShadow: "0 1px 3px 0 #a082c345"
                      }}
                    />
                    {/* --- Document Actions --- */}
                    <Stack spacing={1.1} mt={1.2} alignItems="stretch">
                      <Tooltip title={st.bol ? "View Bill of Lading PDF" : "Generate Bill of Lading (BOL) PDF"} arrow placement="top">
                        <Button
                          fullWidth
                          variant={st.bol ? "contained" : "outlined"}
                          startIcon={st.bol ? <VisibilityIcon /> : <PictureAsPdfIcon />}
                          sx={{
                            bgcolor: st.bol ? "#2a1148" : "transparent",
                            color: "#fff",
                            borderColor: "#fff",
                            borderWidth: 2,
                            fontWeight: 700,
                            borderRadius: 6,
                            py: 1,
                            fontSize: "0.97em",
                            letterSpacing: 0.01,
                            boxShadow: st.bol ? "0 2px 8px #2a114888" : "none",
                            "&:hover": {
                              bgcolor: "#2a1148e7",
                              color: "#e0c6ff",
                              borderColor: "#c4b2ef",
                            }
                          }}
                          onClick={() => st.bol ? openPreview(st.bol) : handleGenerateBOL(load._id)}
                          disabled={busy[load._id] === "bol"}
                        >
                          {busy[load._id] === "bol"
                            ? <CircularProgress size={16} />
                            : st.bol ? "View BOL" : "Generate BOL"}
                        </Button>
                      </Tooltip>
                      <Tooltip title={st.invoice ? "View Invoice PDF" : "Generate Invoice PDF"} arrow placement="top">
                        <Button
                          fullWidth
                          variant={st.invoice ? "contained" : "outlined"}
                          startIcon={st.invoice ? <VisibilityIcon /> : <PictureAsPdfIcon />}
                          sx={{
                            bgcolor: st.invoice ? "#2a1148" : "transparent",
                            color: "#fff",
                            borderColor: "#fff",
                            borderWidth: 2,
                            fontWeight: 700,
                            borderRadius: 6,
                            py: 1,
                            fontSize: "0.97em",
                            letterSpacing: 0.01,
                            boxShadow: st.invoice ? "0 2px 8px #2a114888" : "none",
                            "&:hover": {
                              bgcolor: "#2a1148e7",
                              color: "#e0c6ff",
                              borderColor: "#c4b2ef",
                            }
                          }}
                          onClick={() => st.invoice ? openPreview(st.invoice) : handleGenerateInvoice(load._id)}
                          disabled={busy[load._id] === "invoice"}
                        >
                          {busy[load._id] === "invoice"
                            ? <CircularProgress size={16} />
                            : st.invoice ? "View Invoice" : "Generate Invoice"}
                        </Button>
                      </Tooltip>
                      {/* --- POD --- */}
                      <Tooltip title={st.pod ? "View Proof of Delivery (POD)" : "Upload signed Proof of Delivery PDF"} arrow placement="top">
                        {st.pod ? (
                          <Button
                            fullWidth
                            variant="contained"
                            startIcon={<DescriptionIcon />}
                            sx={{
                              bgcolor: POD_GREEN,
                              color: "#fff",
                              borderRadius: 6,
                              fontWeight: 700,
                              fontSize: "0.97em",
                              py: 1,
                              boxShadow: "0 2px 8px #3ec17c55",
                              letterSpacing: 0.01,
                              "&:hover": { bgcolor: "#259159" }
                            }}
                            onClick={() => openPreview(st.pod)}
                          >
                            View POD
                          </Button>
                        ) : (
                          <Button
                            component="label"
                            fullWidth
                            variant="outlined"
                            startIcon={<UploadIcon />}
                            sx={{
                              color: POD_GREEN,
                              borderColor: POD_GREEN,
                              borderWidth: 2,
                              borderRadius: 6,
                              fontWeight: 700,
                              fontSize: "0.97em",
                              py: 1,
                              letterSpacing: 0.01,
                              bgcolor: "transparent",
                              "&:hover": { bgcolor: "#eafbf2", borderColor: "#259159" }
                            }}
                            disabled={busy[load._id] === "pod"}
                          >
                            {busy[load._id] === "pod"
                              ? <CircularProgress size={16} />
                              : "Upload POD"}
                            <input
                              type="file"
                              accept="application/pdf"
                              hidden
                              onChange={(e) =>
                                e.target.files.length &&
                                handleUploadPOD(load._id, e.target.files[0])
                              }
                            />
                          </Button>
                        )}
                      </Tooltip>
                    </Stack>
                  </CardContent>
                </Card>
              </Fade>
            </Grid>
          );
        })}
      </Grid>
      {/* Pagination */}
      <Stack direction="row" justifyContent="center" sx={{ mt: 4, mb: 2 }}>
        {totalPages > 1 && (
          <Pagination
            count={totalPages}
            color="secondary"
            page={page}
            onChange={(_, val) => setPage(val)}
            sx={{
              "& .MuiPaginationItem-root": {
                bgcolor: "#4c318f",
                color: "#fff",
                borderRadius: 2,
                fontWeight: 700,
                "&.Mui-selected": {
                  bgcolor: "#3ec17c",
                  color: "#fff"
                }
              }
            }}
          />
        )}
      </Stack>
      <PDFPreview
        open={preview.open}
        url={preview.url}
        onClose={() => setPreview({ open: false, url: "" })}
      />
    </Box>
  );
}
