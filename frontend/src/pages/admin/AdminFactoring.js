import { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TablePagination, Chip, Stack, CircularProgress, Button, Tabs, Tab,
  Drawer, Divider, TextField, Alert, Link, IconButton,
} from "@mui/material";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import GavelIcon from "@mui/icons-material/Gavel";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import api from "../../services/api";
import { brand, surface, text as T, tint, semantic } from "../../theme/tokens";

const STATUS_FILTERS = ["all", "pending_verification", "active", "released", "rejected", "disputed"];

const STATUS_COLOR = {
  pending_verification: semantic.warning,
  active: semantic.success,
  released: semantic.muted,
  rejected: semantic.error,
  disputed: semantic.orange,
};

const PAYEE_META = {
  carrier: { label: "PAY CARRIER", color: semantic.success },
  factor:  { label: "PAY FACTOR", color: semantic.orange },
  hold:    { label: "PAYMENT HELD", color: semantic.error },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const statusLabel = (s) => String(s || "").replace(/_/g, " ");

function StatusChip({ value }) {
  const c = STATUS_COLOR[value] || semantic.muted;
  return (
    <Chip size="small" label={statusLabel(value)}
      sx={{ fontWeight: 800, textTransform: "capitalize", bgcolor: tint(c, 0.16), color: c }} />
  );
}

export default function AdminFactoring() {
  const [filter, setFilter] = useState("all");
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const rowsPerPage = 10;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // drawer
  const [selected, setSelected] = useState(null);
  const [payee, setPayee] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drawerErr, setDrawerErr] = useState("");
  const [drawerMsg, setDrawerMsg] = useState("");

  // action inputs
  const [releaseUrl, setReleaseUrl] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [reason, setReason] = useState("");

  const fetchRows = useCallback(async (f, pg = 0) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: pg + 1, limit: rowsPerPage });
      if (f !== "all") q.set("status", f);
      const res = await api.get(`/factoring-assignments?${q}`);
      const data = res.data || {};
      setRows(data.items || data.data || data.assignments || data.rows || []);
      setTotal(data.total ?? data.count ?? 0);
    } catch {
      setRows([]); setTotal(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(filter, page); }, [filter, page, fetchRows]);

  const openDrawer = async (row) => {
    setSelected(row); setPayee(null); setDrawerErr(""); setDrawerMsg("");
    setReleaseUrl(""); setReleaseNote(""); setReason("");
    const carrierId = row.carrier?._id || row.carrier;
    if (carrierId) {
      try {
        const res = await api.get(`/factoring-assignments/carrier/${carrierId}/payee`);
        setPayee(res.data);
      } catch { setPayee(null); }
    }
  };

  const closeDrawer = () => { if (!busy) setSelected(null); };

  const refreshAfterAction = async () => {
    fetchRows(filter, page);
    if (selected?._id) {
      try {
        const res = await api.get(`/factoring-assignments/${selected._id}`);
        setSelected(res.data?.data || res.data);
      } catch { /* keep existing */ }
    }
  };

  const runAction = async (mode) => {
    if (!selected) return;
    setBusy(true); setDrawerErr(""); setDrawerMsg("");
    try {
      const id = selected._id;
      if (mode === "verify") {
        await api.put(`/factoring-assignments/${id}/verify`);
        setDrawerMsg("Assignment verified and activated.");
      } else if (mode === "release") {
        if (!releaseUrl.trim()) { setDrawerErr("Release document URL is required."); setBusy(false); return; }
        await api.put(`/factoring-assignments/${id}/release`, { releaseDocumentUrl: releaseUrl.trim(), note: releaseNote.trim() });
        setDrawerMsg("Assignment released.");
      } else if (mode === "reject") {
        if (!reason.trim()) { setDrawerErr("Reason is required."); setBusy(false); return; }
        await api.put(`/factoring-assignments/${id}/reject`, { reason: reason.trim() });
        setDrawerMsg("Assignment rejected.");
      } else if (mode === "dispute") {
        if (!reason.trim()) { setDrawerErr("Reason is required."); setBusy(false); return; }
        await api.put(`/factoring-assignments/${id}/dispute`, { reason: reason.trim() });
        setDrawerMsg("Assignment marked as disputed.");
      }
      await refreshAfterAction();
    } catch (err) {
      // 409 — e.g. another active assignment exists for this carrier
      setDrawerErr(err?.response?.data?.error || err?.response?.data?.message || "Action failed.");
    }
    setBusy(false);
  };

  const cellHead = { color: T.primary, fontWeight: 900, whiteSpace: "nowrap" };

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
        <RequestQuoteIcon sx={{ color: brand.pink }} />
        <Typography variant="h5" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
          Factoring Assignments (NOA)
        </Typography>
      </Stack>

      {/* Legal banner */}
      <Alert severity="warning" icon={<GavelIcon />} sx={{ mb: 2.5 }}>
        <strong>Factoring NOA — payments are redirected per UCC §9-406.</strong> Verify the Notice of Assignment
        document before activating. Once active, this carrier&apos;s payouts route to the factor, not the carrier.
      </Alert>

      <Tabs
        value={filter}
        onChange={(_, v) => { setFilter(v); setPage(0); }}
        variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, "& .MuiTab-root": { color: T.secondary, fontWeight: 800, textTransform: "capitalize" },
          "& .Mui-selected": { color: `${brand.pink} !important` }, "& .MuiTabs-indicator": { bgcolor: brand.pink } }}
      >
        {STATUS_FILTERS.map((s) => <Tab key={s} value={s} label={statusLabel(s) || "all"} />)}
      </Tabs>

      <Paper elevation={0} sx={{
        borderRadius: 4, background: surface.indigoTint,
        boxShadow: "0 4px 24px #1e034315", overflow: "hidden",
      }}>
        {loading ? (
          <Box p={8} display="flex" justifyContent="center"><CircularProgress /></Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={cellHead}>Carrier</TableCell>
                    <TableCell sx={cellHead}>MC #</TableCell>
                    <TableCell sx={cellHead}>Factor</TableCell>
                    <TableCell sx={cellHead}>Status</TableCell>
                    <TableCell sx={cellHead}>Effective</TableCell>
                    <TableCell sx={cellHead}>NOA</TableCell>
                    <TableCell sx={cellHead} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} align="center" sx={{ color: T.muted }}>No assignments.</TableCell></TableRow>
                  ) : rows.map((r) => {
                    const c = r.carrier || {};
                    return (
                      <TableRow key={r._id} hover sx={{ cursor: "pointer" }} onClick={() => openDrawer(r)}>
                        <TableCell sx={{ color: T.primary }}>
                          <Typography variant="body2" fontWeight={800} sx={{ color: T.primary }}>{c.name || "—"}</Typography>
                          <Typography variant="caption" sx={{ color: T.secondary }}>{c.companyName || c.email || ""}</Typography>
                        </TableCell>
                        <TableCell sx={{ color: T.primary }}>{c.mcNumber || "—"}</TableCell>
                        <TableCell sx={{ color: T.primary }}>{r.factorCompanyName || "—"}</TableCell>
                        <TableCell><StatusChip value={r.status} /></TableCell>
                        <TableCell sx={{ color: T.primary }}>{fmtDate(r.effectiveDate)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {r.noaDocumentUrl ? (
                            <Link href={r.noaDocumentUrl} target="_blank" rel="noopener"
                              sx={{ color: brand.indigoLight, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                              View <OpenInNewIcon sx={{ fontSize: 14 }} />
                            </Link>
                          ) : <Typography variant="body2" sx={{ color: T.muted }}>—</Typography>}
                        </TableCell>
                        <TableCell>
                          <Button size="small" onClick={(e) => { e.stopPropagation(); openDrawer(r); }}
                            sx={{ color: brand.pink, fontWeight: 800 }}>Review</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div" count={total} page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage} rowsPerPageOptions={[10]}
              sx={{ ".MuiTablePagination-toolbar": { color: brand.indigoLight } }}
            />
          </>
        )}
      </Paper>

      {/* Detail drawer */}
      <Drawer anchor="right" open={Boolean(selected)} onClose={closeDrawer}
        PaperProps={{ sx: { width: { xs: "100%", sm: 460 }, background: surface.modal, backdropFilter: "blur(20px)", p: 3 } }}>
        {selected && (
          <Box>
            <Stack direction="row" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
                Factoring Assignment
              </Typography>
              <IconButton onClick={closeDrawer} sx={{ color: T.secondary }}><CloseIcon /></IconButton>
            </Stack>

            <StatusChip value={selected.status} />

            {payee && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" sx={{ color: T.muted, fontWeight: 800 }}>Current payee routing</Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip
                    label={(PAYEE_META[payee.payTo] || { label: String(payee.payTo || "—").toUpperCase() }).label}
                    sx={{ fontWeight: 900,
                      bgcolor: tint((PAYEE_META[payee.payTo] || {}).color || semantic.muted, 0.16),
                      color: (PAYEE_META[payee.payTo] || {}).color || semantic.muted }} />
                  {payee.reason && (
                    <Typography variant="caption" sx={{ display: "block", color: T.secondary, mt: 0.5 }}>
                      {payee.reason}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}

            <Divider sx={{ borderColor: surface.glassBorder, my: 2 }} />

            <Stack spacing={1}>
              <Field label="Carrier" value={selected.carrier?.name} sub={selected.carrier?.companyName} />
              <Field label="Carrier email" value={selected.carrier?.email} />
              <Field label="MC #" value={selected.carrier?.mcNumber} />
              <Field label="Factor company" value={selected.factorCompanyName} />
              <Field label="Remit to" value={selected.factorRemitTo} />
              <Field label="Factor contact" value={selected.factorContactEmail} />
              <Field label="Effective date" value={fmtDate(selected.effectiveDate)} />
              {selected.noaDocumentUrl && (
                <Box>
                  <Typography variant="caption" sx={{ color: T.muted, fontWeight: 800 }}>NOA Document</Typography>
                  <Box>
                    <Link href={selected.noaDocumentUrl} target="_blank" rel="noopener"
                      sx={{ color: brand.indigoLight, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      Open NOA <OpenInNewIcon sx={{ fontSize: 14 }} />
                    </Link>
                  </Box>
                </Box>
              )}
            </Stack>

            <Divider sx={{ borderColor: surface.glassBorder, my: 2 }} />

            {drawerErr && <Alert severity="error" sx={{ mb: 2 }}>{drawerErr}</Alert>}
            {drawerMsg && <Alert severity="success" sx={{ mb: 2 }}>{drawerMsg}</Alert>}

            {/* Actions */}
            <Typography variant="subtitle2" fontWeight={800} sx={{ color: T.primary, mb: 1 }}>Actions</Typography>

            {selected.status === "pending_verification" && (
              <Stack direction="row" spacing={1.5} mb={2}>
                <Button variant="contained" disabled={busy} onClick={() => runAction("verify")}
                  sx={{ bgcolor: semantic.success, color: "#06281b", fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#2bb985" } }}>
                  {busy ? <CircularProgress size={20} /> : "Verify & Activate"}
                </Button>
                <Button variant="outlined" color="error" disabled={busy} onClick={() => runAction("reject")}
                  sx={{ fontWeight: 800, borderRadius: 99 }}>Reject</Button>
              </Stack>
            )}

            {/* Reject / dispute reason input */}
            {["pending_verification", "active"].includes(selected.status) && (
              <TextField
                fullWidth size="small" multiline minRows={2} sx={{ mb: 2 }}
                label="Reason (for reject / dispute)" value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}

            {selected.status === "active" && (
              <>
                <Stack direction="row" spacing={1.5} mb={2}>
                  <Button variant="outlined" color="warning" disabled={busy} onClick={() => runAction("dispute")}
                    sx={{ fontWeight: 800, borderRadius: 99 }}>Dispute</Button>
                </Stack>
                <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />
                <Typography variant="subtitle2" fontWeight={800} sx={{ color: T.primary, mb: 1 }}>
                  Release assignment
                </Typography>
                <TextField fullWidth size="small" sx={{ mb: 1.5 }} required
                  label="Release document URL" value={releaseUrl}
                  onChange={(e) => setReleaseUrl(e.target.value)} />
                <TextField fullWidth size="small" multiline minRows={2} sx={{ mb: 1.5 }}
                  label="Release note" value={releaseNote}
                  onChange={(e) => setReleaseNote(e.target.value)} />
                <Button variant="contained" disabled={busy} onClick={() => runAction("release")}
                  sx={{ bgcolor: brand.indigo, fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#4338ca" } }}>
                  {busy ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Release"}
                </Button>
              </>
            )}

            {["released", "rejected", "disputed"].includes(selected.status) && (
              <Typography variant="body2" sx={{ color: T.muted }}>
                No further actions available for a {statusLabel(selected.status)} assignment.
              </Typography>
            )}
          </Box>
        )}
      </Drawer>
    </Box>
  );
}

function Field({ label, value, sub }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: T.muted, fontWeight: 800 }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: T.primary }}>{value || "—"}</Typography>
      {sub && <Typography variant="caption" sx={{ color: T.secondary }}>{sub}</Typography>}
    </Box>
  );
}
