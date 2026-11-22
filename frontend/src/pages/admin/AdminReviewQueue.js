import { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Typography, Stack, Chip, CircularProgress, Button, Tabs, Tab,
  Divider, TablePagination, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert,
} from "@mui/material";
import GavelIcon from "@mui/icons-material/Gavel";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import api from "../../services/api";
import { brand, surface, text as T, tint, semantic, severity as SEV } from "../../theme/tokens";

const STATUSES = ["pending", "approved", "dismissed"];
// Mirrors the ReviewQueue.type enum; "all" sends no type filter.
const TYPES = [
  ["carrier_suspension", "Carrier suspensions"],
  ["pickup_no_show", "Suspected no-shows"],
  ["fraud_flag", "Fraud flags"],
  ["other", "Other"],
  ["all", "All"],
];
const CONFIRMATION = { on_my_way: "Carrier said it was on the way", cannot_make_it: "Carrier said it could not make it" };
const SIGNAL_LABEL = { geofence: "Geofence arrival", verifiedCode: "Pickup code verified", signature: "Pickup signature", photo: "Pickup photo near the facility" };
// verified = authenticated as the booked carrier (geofence) or corroborated by one (signature / photo / code)
const signalState = (k, v) => {
  if (k === "verifiedCode") return v ? "found, verified" : "not found";
  if (!v) return "not found";
  if (k === "geofence") return v === "authenticated" ? "found, verified" : `found, NOT verified (${v === "manual" ? "manual check-in" : v === "unauthenticated" ? "link-token position" : "unknown source"})`;
  return v === "corroborated" ? "found, verified" : "found, NOT verified (nothing else corroborates it)";
};
const fix = (f) => (f ? `${fmtDate(f.at)}${f.distanceMiles != null ? `, ${f.distanceMiles} mi from the pickup` : ""}${f.source ? `, source: ${f.source}` : ""}` : "none recorded");

function NoShowEvidence({ d }) {
  const w = d.agreedWindow || {};
  const sig = d.arrivalSignals || {};
  const rows = [
    ["Load", `${d.loadTitle || "—"} (${d.carrierCompany || "carrier"} for ${d.shipperCompany || "shipper"})`],
    ["Agreed pickup window", `${fmtDate(w.start)} to ${fmtDate(w.end)}`],
    ["Latest arrival time", fmtDate(w.latestArrivalAt)],
    ["Arrival signals found", d.arrivalSignalsFound ? "Yes" : "No"],
    ...Object.keys(SIGNAL_LABEL).map((k) => [SIGNAL_LABEL[k], signalState(k, sig[k])]),
    ["Last verified position", fix(d.lastAuthenticatedFix)],
    ["Last position of any kind", d.lastFix ? `${fix(d.lastFix)}${d.lastFix.authenticated ? " (verified)" : " (not verified)"}` : "none recorded"],
    ["Carrier's own confirmation", CONFIRMATION[d.carrierConfirmation] || "none"],
    ["Released by", `${d.releasedByRole || "—"} on ${fmtDate(d.releasedAt)}`],
  ];
  return (
    <Box sx={{ bgcolor: surface.glassSubtle, borderRadius: 2, p: 1.5, mb: 1 }}>
      <Typography variant="caption" sx={{ color: T.muted, fontWeight: 800 }}>Evidence at release</Typography>
      <Stack spacing={0.6} mt={0.5}>
        {rows.map(([k, v]) => (
          <Stack key={k} direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0, sm: 1.5 }}>
            <Typography variant="body2" sx={{ color: T.muted, minWidth: { sm: 210 }, fontWeight: 700 }}>{k}</Typography>
            <Typography variant="body2" sx={{ color: T.secondary, flex: 1, minWidth: 0 }}>{v}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const sevColor = (s) => SEV[String(s).toLowerCase()] || SEV.medium;

function SeverityChip({ value }) {
  const c = sevColor(value);
  return (
    <Chip size="small" label={value || "—"}
      sx={{ fontWeight: 800, textTransform: "uppercase", bgcolor: tint(c, 0.16), color: c }} />
  );
}

export default function AdminReviewQueue() {
  const [status, setStatus] = useState("pending");
  const [type, setType] = useState("carrier_suspension");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const rowsPerPage = 10;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({});

  // action dialog
  const [dialog, setDialog] = useState({ open: false, mode: "", item: null });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");

  const fetchStats = useCallback(async (ty) => {
    try {
      const res = await api.get(`/review-queue/stats${ty && ty !== "all" ? `?type=${ty}` : ""}`);
      setStats(res.data?.data || {});
    } catch { setStats({}); }
  }, []);

  const fetchItems = useCallback(async (st, ty, pg = 0) => {
    setLoading(true);
    try {
      const res = await api.get(`/review-queue?status=${st}${ty === "all" ? "" : `&type=${ty}`}&page=${pg + 1}&limit=${rowsPerPage}`);
      const data = res.data || {};
      setItems(data.items || data.data || data.rows || []);
      setTotal(data.pagination?.total ?? data.total ?? data.count ?? 0);
    } catch {
      setItems([]); setTotal(0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(type); }, [type, fetchStats]);
  useEffect(() => { fetchItems(status, type, page); }, [status, type, page, fetchItems]);

  const openAction = (mode, item) => { setDialog({ open: true, mode, item }); setNote(""); setActionErr(""); };
  const closeAction = () => { if (!busy) setDialog({ open: false, mode: "", item: null }); };

  const submitAction = async () => {
    const { mode, item } = dialog;
    if (item?.type === "pickup_no_show" && !note.trim()) { setActionErr("A note is required to record a decision."); return; }
    setBusy(true); setActionErr("");
    try {
      await api.put(`/review-queue/${item._id}/${mode === "approve" ? "approve" : "dismiss"}`, { reviewNote: note });
      setDialog({ open: false, mode: "", item: null });
      setNote("");
      fetchItems(status, type, page);
      fetchStats(type);
    } catch (err) {
      setActionErr(err?.response?.data?.error || "Action failed. Please try again.");
    }
    setBusy(false);
  };

  const statCount = (k) => stats[k] ?? stats[`${k}Count`] ?? 0;

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
        <GavelIcon sx={{ color: brand.pink }} />
        <Typography variant="h5" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
          Review Queue
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: T.secondary, mb: 2 }}>
        Human-in-the-loop carrier enforcement. The fraud engine flags carriers; an admin must approve.
        {type === "pickup_no_show" ? (
          <strong style={{ color: T.primary }}> Recording a decision does not change the carrier&apos;s trust score.</strong>
        ) : type === "carrier_suspension" ? (
          <strong style={{ color: T.primary }}> Approving a carrier suspension review suspends the carrier.</strong>
        ) : (
          <strong style={{ color: T.primary }}> Only approving a carrier suspension review suspends a carrier; other types record the decision only.</strong>
        )}
      </Typography>

      {/* Stats chips */}
      <Stack direction="row" spacing={1.5} mb={2} flexWrap="wrap" useFlexGap>
        {STATUSES.map((s) => (
          <Chip key={s} label={`${s}: ${statCount(s)}`}
            sx={{
              fontWeight: 800, textTransform: "capitalize",
              bgcolor: s === "pending" ? tint(semantic.warning, 0.16) : s === "approved" ? tint(semantic.error, 0.16) : tint(semantic.muted, 0.16),
              color: s === "pending" ? semantic.warning : s === "approved" ? semantic.error : semantic.muted,
            }}
          />
        ))}
      </Stack>

      <Tabs
        value={type}
        onChange={(_, v) => { setType(v); setPage(0); }}
        variant="scrollable" scrollButtons="auto"
        sx={{ mb: 1, "& .MuiTab-root": { color: T.secondary, fontWeight: 800 },
          "& .Mui-selected": { color: `${brand.pink} !important` }, "& .MuiTabs-indicator": { bgcolor: brand.pink } }}
      >
        {TYPES.map(([v, label]) => <Tab key={v} value={v} label={label} />)}
      </Tabs>

      <Tabs
        value={status}
        onChange={(_, v) => { setStatus(v); setPage(0); }}
        sx={{ mb: 2, "& .MuiTab-root": { color: T.secondary, fontWeight: 800, textTransform: "capitalize" },
          "& .Mui-selected": { color: `${brand.pink} !important` }, "& .MuiTabs-indicator": { bgcolor: brand.pink } }}
      >
        {STATUSES.map((s) => <Tab key={s} value={s} label={s} />)}
      </Tabs>

      {loading ? (
        <Box p={8} display="flex" justifyContent="center"><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper elevation={0} sx={{ p: 5, borderRadius: 4, textAlign: "center", background: surface.glass, color: T.muted }}>
          No {status} reviews{type === "all" ? "" : " of this type"}.
        </Paper>
      ) : (
        <Stack spacing={2}>
          {items.map((it) => {
            const subj = it.subjectUser || {};
            const details = it.details || {};
            const breakdown = details.breakdown || details.factors || details.reasons;
            const isNoShow = it.type === "pickup_no_show";
            const isSuspension = it.type === "carrier_suspension";
            return (
              <Paper key={it._id} elevation={0} sx={{
                borderRadius: 4, p: { xs: 2.5, sm: 3 },
                background: surface.indigoTint, border: `1px solid ${surface.indigoBorderLight}`,
                boxShadow: "0 4px 24px #1e034315",
                overflowWrap: "anywhere",
              }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} mb={1.5}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="h6" fontWeight={900} sx={{ color: T.primary }}>
                      {subj.name || "Unknown carrier"}
                    </Typography>
                    <Typography variant="body2" sx={{ color: T.secondary }}>
                      {subj.companyName || "—"}{subj.email ? ` · ${subj.email}` : ""}
                    </Typography>
                  </Box>
                  <SeverityChip value={it.severity} />
                  {typeof it.riskScore === "number" && (
                    <Chip label={`Risk ${it.riskScore}`} size="small"
                      sx={{ fontWeight: 800, bgcolor: tint(semantic.error, 0.14), color: semantic.error }} />
                  )}
                </Stack>

                <Typography variant="body2" sx={{ color: T.primary, mb: 1 }}>
                  <strong style={{ color: T.strong }}>Reason:</strong> {it.reason || "—"}
                </Typography>
                {it.recommendedAction && (
                  <Typography variant="body2" sx={{ color: T.secondary, mb: 1 }}>
                    Recommended action: {it.recommendedAction}
                  </Typography>
                )}

                {isNoShow && <NoShowEvidence d={details} />}
                {!isNoShow && breakdown && (
                  <Box sx={{ bgcolor: surface.glassSubtle, borderRadius: 2, p: 1.5, mb: 1 }}>
                    <Typography variant="caption" sx={{ color: T.muted, fontWeight: 800 }}>Details</Typography>
                    {Array.isArray(breakdown) ? (
                      <Stack component="ul" sx={{ m: 0, pl: 2.5, color: T.secondary }}>
                        {breakdown.map((b, i) => (
                          <li key={i}><Typography variant="body2" sx={{ color: T.secondary }}>
                            {typeof b === "string" ? b : `${b.label || b.factor || ""}: ${b.value ?? b.score ?? ""}`}
                          </Typography></li>
                        ))}
                      </Stack>
                    ) : (
                      <Stack spacing={0.3} mt={0.5}>
                        {Object.entries(breakdown).map(([k, v]) => (
                          <Typography key={k} variant="body2" sx={{ color: T.secondary }}>
                            {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </Typography>
                        ))}
                      </Stack>
                    )}
                  </Box>
                )}

                <Divider sx={{ borderColor: surface.glassBorder, my: 1.5 }} />
                <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="caption" sx={{ color: T.muted, flex: 1 }}>
                    Flagged {fmtDate(it.createdAt)}
                  </Typography>
                  {status === "pending" && (
                    <>
                      <Button variant="outlined" onClick={() => openAction("dismiss", it)}
                        sx={{ color: T.secondary, borderColor: surface.glassBorder, fontWeight: 800, borderRadius: 99 }}>
                        {isNoShow ? "Mark reviewed — no action" : "Dismiss"}
                      </Button>
                      <Button variant="contained" color={isSuspension ? "error" : "primary"} startIcon={isSuspension ? <WarningAmberIcon /> : null}
                        onClick={() => openAction("approve", it)}
                        sx={{ fontWeight: 800, borderRadius: 99 }}>
                        {isNoShow ? "Mark reviewed — carrier at fault" : isSuspension ? "Approve & Suspend Carrier" : "Approve"}
                      </Button>
                    </>
                  )}
                  {status !== "pending" && (
                    <Chip size="small" label={status}
                      sx={{ fontWeight: 800, textTransform: "capitalize",
                        bgcolor: tint(status === "approved" ? semantic.error : semantic.muted, 0.14),
                        color: status === "approved" ? semantic.error : semantic.muted }} />
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {total > rowsPerPage && (
        <TablePagination
          component="div" count={total} page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage} rowsPerPageOptions={[10]}
          sx={{ ".MuiTablePagination-toolbar": { color: brand.indigoLight } }}
        />
      )}

      {/* Action dialog */}
      <Dialog open={dialog.open} onClose={closeAction} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>
          {dialog.item?.type === "pickup_no_show"
            ? (dialog.mode === "approve" ? "Mark reviewed — carrier at fault" : "Mark reviewed — no action")
            : dialog.mode === "approve" ? (dialog.item?.type === "carrier_suspension" ? "Approve & Suspend Carrier" : "Approve Review") : "Dismiss Review"}
        </DialogTitle>
        <DialogContent>
          {dialog.item?.type === "pickup_no_show" ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              This records your decision only. Recording a decision does not change the carrier&apos;s trust score.
            </Alert>
          ) : dialog.mode !== "approve" ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Dismissing clears this flag without suspending the carrier.
            </Alert>
          ) : dialog.item?.type !== "carrier_suspension" ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Approving records the decision only; no account action is taken automatically.
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This will <strong>suspend {dialog.item?.subjectUser?.name || "the carrier"}</strong> and apply the
              recommended enforcement action. This is a human-in-the-loop decision — proceed only if the flag is valid.
            </Alert>
          )}
          {actionErr && <Alert severity="error" sx={{ mb: 2 }}>{actionErr}</Alert>}
          <TextField
            fullWidth multiline minRows={2} label={dialog.item?.type === "pickup_no_show" ? "Review note (required)" : "Review note (optional)"}
            required={dialog.item?.type === "pickup_no_show"}
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for the audit trail…"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAction} disabled={busy}>Cancel</Button>
          <Button
            variant="contained" color={dialog.mode === "approve" ? "error" : "primary"}
            onClick={submitAction} disabled={busy}
            sx={{ fontWeight: 800 }}
          >
            {busy ? <CircularProgress size={20} sx={{ color: "#fff" }} />
              : dialog.item?.type === "pickup_no_show" ? "Record decision"
              : dialog.mode === "approve" ? (dialog.item?.type === "carrier_suspension" ? "Confirm Suspension" : "Confirm Approval") : "Confirm Dismiss"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
