import { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, Chip, Stack, CircularProgress,
  TextField, Button, InputAdornment, Tooltip,
} from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import api from "../../services/api";
import { brand, surface, text as T, tint, semantic } from "../../theme/tokens";

const fmtMoney = (cents) =>
  `$${(((cents ?? 0)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");
const shortId = (id) => (id ? `${String(id).slice(0, 8)}…` : "—");

const cellHead = { color: T.primary, fontWeight: 900, whiteSpace: "nowrap" };
const cellBody = { color: T.primary };

function DirectionChip({ direction }) {
  const isDebit = String(direction).toLowerCase() === "debit";
  return (
    <Chip
      size="small" label={direction}
      sx={{
        fontWeight: 700, textTransform: "capitalize",
        bgcolor: isDebit ? tint(semantic.error, 0.14) : tint(semantic.success, 0.14),
        color: isDebit ? semantic.error : semantic.success,
      }}
    />
  );
}

function CardRow({ label, value, title }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={1}>
      <Typography sx={{ color: T.muted, fontSize: "0.78em", flexShrink: 0 }}>{label}</Typography>
      <Tooltip title={title || ""}>
        <Typography sx={{ color: T.primary, fontSize: "0.85em", textAlign: "right", wordBreak: "break-word" }}>
          {value}
        </Typography>
      </Tooltip>
    </Stack>
  );
}

export default function AdminLedger() {
  // Reconciliation
  const [recon, setRecon] = useState(null);
  const [reconLoading, setReconLoading] = useState(true);
  const [reconErr, setReconErr] = useState("");

  // Paginated entries
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(0);
  const rowsPerPage = 10;
  const [total, setTotal] = useState(0);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Load lookup
  const [loadId, setLoadId] = useState("");
  const [loadEntries, setLoadEntries] = useState(null);
  const [loadLoading, setLoadLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const fetchRecon = useCallback(async () => {
    setReconLoading(true); setReconErr("");
    try {
      const res = await api.get("/ledger/reconcile");
      setRecon(res.data);
    } catch (err) {
      setReconErr(err?.response?.data?.error || "Failed to load reconciliation.");
      setRecon(null);
    }
    setReconLoading(false);
  }, []);

  const fetchEntries = useCallback(async (pg = 0) => {
    setEntriesLoading(true);
    try {
      const res = await api.get(`/ledger?page=${pg + 1}&limit=${rowsPerPage}`);
      const data = res.data || {};
      setEntries(data.entries || data.rows || data.data || []);
      setTotal(data.total ?? data.count ?? 0);
    } catch {
      setEntries([]); setTotal(0);
    }
    setEntriesLoading(false);
  }, []);

  useEffect(() => { fetchRecon(); }, [fetchRecon]);
  useEffect(() => { fetchEntries(page); }, [page, fetchEntries]);

  const handleLoadLookup = async () => {
    const id = loadId.trim();
    setLoadErr(""); setLoadEntries(null);
    if (!id) return;
    setLoadLoading(true);
    try {
      const res = await api.get(`/ledger/load/${encodeURIComponent(id)}`);
      setLoadEntries(Array.isArray(res.data) ? res.data : (res.data?.entries || []));
    } catch (err) {
      setLoadErr(err?.response?.data?.error || "No ledger entries found for that load.");
    }
    setLoadLoading(false);
  };

  const balanced = recon?.balanced;

  const entriesTable = (rows) => (
    <>
      {/* Desktop / tablet: full table (md and up) */}
      <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={cellHead}>Date</TableCell>
              <TableCell sx={cellHead}>Txn</TableCell>
              <TableCell sx={cellHead}>Type</TableCell>
              <TableCell sx={cellHead}>Account</TableCell>
              <TableCell sx={cellHead}>Direction</TableCell>
              <TableCell sx={cellHead} align="right">Amount</TableCell>
              <TableCell sx={cellHead}>Stripe Ref</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ color: T.muted }}>No entries.</TableCell></TableRow>
            ) : rows.map((e, i) => (
              <TableRow key={e._id || i}>
                <TableCell sx={cellBody}>{fmtDate(e.createdAt)}</TableCell>
                <TableCell sx={cellBody}>
                  <Tooltip title={e.transactionId || ""}><span>{shortId(e.transactionId)}</span></Tooltip>
                </TableCell>
                <TableCell sx={cellBody}>{e.entryType || "—"}</TableCell>
                <TableCell sx={cellBody}>{e.account || "—"}</TableCell>
                <TableCell><DirectionChip direction={e.direction} /></TableCell>
                <TableCell sx={{ ...cellBody, fontWeight: 800 }} align="right">{fmtMoney(e.amountCents)}</TableCell>
                <TableCell sx={cellBody}>
                  <Tooltip title={e.stripeRef || ""}><span>{e.stripeRef ? shortId(e.stripeRef) : "—"}</span></Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Phone: stacked cards (below md) so nothing overflows the screen */}
      <Box sx={{ display: { xs: "block", md: "none" }, p: 1.5 }}>
        {rows.length === 0 ? (
          <Typography align="center" sx={{ color: T.muted, py: 4 }}>No entries.</Typography>
        ) : rows.map((e, i) => (
          <Paper
            key={e._id || i}
            elevation={0}
            sx={{ p: 2, mb: 1.5, borderRadius: 3, background: surface.glass, border: `1px solid ${surface.glassBorder}` }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} mb={1}>
              <Typography sx={{ ...cellBody, fontWeight: 800 }}>{fmtMoney(e.amountCents)}</Typography>
              <DirectionChip direction={e.direction} />
            </Stack>
            <Stack spacing={0.5}>
              <CardRow label="Date" value={fmtDate(e.createdAt)} />
              <CardRow label="Type" value={e.entryType || "—"} />
              <CardRow label="Account" value={e.account || "—"} />
              <CardRow label="Txn" value={shortId(e.transactionId)} title={e.transactionId} />
              <CardRow label="Stripe Ref" value={e.stripeRef ? shortId(e.stripeRef) : "—"} title={e.stripeRef} />
            </Stack>
          </Paper>
        ))}
      </Box>
    </>
  );

  return (
    <Box sx={{ py: 5, px: { xs: 0, md: 3 }, width: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={3}>
        <AccountBalanceIcon sx={{ color: brand.pink }} />
        <Typography variant="h5" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
          Ledger &amp; Reconciliation
        </Typography>
        <Button startIcon={<RefreshIcon />} onClick={() => { fetchRecon(); fetchEntries(page); }}
          sx={{ color: brand.pink, fontWeight: 800 }}>
          Refresh
        </Button>
      </Stack>

      {/* Reconciliation card */}
      <Paper elevation={0} sx={{
        borderRadius: 4, p: { xs: 2.5, sm: 3.5 }, mb: 3,
        background: surface.indigoTint, border: `1px solid ${surface.indigoBorderLight}`,
        boxShadow: "0 4px 24px #1e034315",
      }}>
        {reconLoading ? (
          <Box display="flex" justifyContent="center" py={3}><CircularProgress /></Box>
        ) : reconErr ? (
          <Typography sx={{ color: semantic.error }}>{reconErr}</Typography>
        ) : recon && (
          <>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={3} alignItems={{ sm: "center" }} mb={2}>
              <Chip
                icon={balanced
                  ? <CheckCircleIcon sx={{ color: `${semantic.success} !important` }} />
                  : <ErrorOutlineIcon sx={{ color: `${semantic.error} !important` }} />}
                label={balanced ? "BALANCED" : "OUT OF BALANCE"}
                sx={{
                  fontWeight: 900, fontSize: "1.05em", py: 2.5, px: 1, borderRadius: 3,
                  bgcolor: balanced ? tint(semantic.success, 0.16) : tint(semantic.error, 0.16),
                  color: balanced ? semantic.success : semantic.error,
                }}
              />
              <Box>
                <Typography variant="caption" sx={{ color: T.muted }}>Total Debits</Typography>
                <Typography variant="h6" fontWeight={900} sx={{ color: T.primary }}>{fmtMoney(recon.totalDebits)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: T.muted }}>Total Credits</Typography>
                <Typography variant="h6" fontWeight={900} sx={{ color: T.primary }}>{fmtMoney(recon.totalCredits)}</Typography>
              </Box>
            </Stack>

            <Typography variant="subtitle2" sx={{ color: T.secondary, mb: 1, fontWeight: 800 }}>
              By account &amp; direction
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={cellHead}>Account</TableCell>
                    <TableCell sx={cellHead}>Direction</TableCell>
                    <TableCell sx={cellHead} align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(recon.rows || []).length === 0 ? (
                    <TableRow><TableCell colSpan={3} align="center" sx={{ color: T.muted }}>No data.</TableCell></TableRow>
                  ) : recon.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell sx={cellBody}>{r._id?.account || "—"}</TableCell>
                      <TableCell><DirectionChip direction={r._id?.direction} /></TableCell>
                      <TableCell sx={{ ...cellBody, fontWeight: 800 }} align="right">{fmtMoney(r.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Paper>

      {/* Load lookup */}
      <Paper elevation={0} sx={{
        borderRadius: 4, p: { xs: 2.5, sm: 3 }, mb: 3,
        background: surface.glass, border: `1px solid ${surface.glassBorder}`,
      }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ color: T.primary, mb: 1.5 }}>
          Look up entries by Load ID
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} mb={loadEntries || loadErr ? 2 : 0}>
          <TextField
            size="small" placeholder="Load ID" value={loadId}
            onChange={(e) => setLoadId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoadLookup()}
            slotProps={{ input: {
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: brand.indigoLight }} /></InputAdornment>,
              sx: { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
            } }}
            sx={{ flex: 1, "& input": { color: T.primary } }}
          />
          <Button variant="contained" onClick={handleLoadLookup} disabled={loadLoading}
            sx={{ bgcolor: brand.indigo, fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#4338ca" } }}>
            {loadLoading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Look up"}
          </Button>
        </Stack>
        {loadErr && <Typography sx={{ color: semantic.error, mt: 1 }}>{loadErr}</Typography>}
        {loadEntries && entriesTable(loadEntries)}
      </Paper>

      {/* Recent entries */}
      <Typography variant="subtitle1" fontWeight={800} sx={{ color: T.primary, mb: 1.5 }}>
        Recent ledger entries
      </Typography>
      <Paper elevation={0} sx={{
        borderRadius: 4, background: surface.indigoTint,
        boxShadow: "0 4px 24px #1e034315", overflow: "hidden",
      }}>
        {entriesLoading ? (
          <Box p={8} display="flex" justifyContent="center"><CircularProgress /></Box>
        ) : (
          <>
            {entriesTable(entries)}
            <TablePagination
              component="div" count={total} page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage} rowsPerPageOptions={[10]}
              sx={{ ".MuiTablePagination-toolbar": { color: brand.indigoLight } }}
            />
          </>
        )}
      </Paper>
    </Box>
  );
}
