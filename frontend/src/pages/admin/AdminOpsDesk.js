import React, { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "react-router-dom";
import api from "../../services/api";

const SEVERITY_COLOR = { critical: "error", high: "error", medium: "warning", low: "default" };
const ACTION_LABEL = { approve: "Recommend: approve", deny: "Recommend: deny", resolve: "Recommend: resolve", dismiss: "Recommend: dismiss", review: "Needs your decision" };
const KIND_LABEL = {
  payout: "Payout", claim: "Claim", exception: "Issue", fraud: "Fraud", review: "Account", carrier_verification: "Carrier", shipper_verification: "Shipper", contact: "Message",
};
const age = (h) => (h < 1 ? "under an hour" : h < 48 ? `${h} h` : `${Math.round(h / 24)} days`);

/** Everything that needs a person, in one list, each with a rule-based recommendation. Recommendations never act. */
export default function AdminOpsDesk() {
  const navigate = useNavigate();
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.get("/admin/ops-desk").then((r) => setDesk(r.data)).catch(() => setError("The operations desk could not be loaded."));
  }, []);
  useEffect(load, [load]);

  return (
    <Box sx={{ width: "100%", maxWidth: 1100, mx: "auto", py: { xs: 1, md: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={1}>
        <Typography variant="h5" fontWeight={900} sx={{ flex: 1 }}>Operations Desk</Typography>
        <IconButton onClick={load} color="secondary" size="large" aria-label="Refresh"><RefreshIcon /></IconButton>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Every open case that needs a person. Recommendations come from fixed rules and never act on their own: you decide on the case&apos;s own screen.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!desk && !error && <Box py={8} display="flex" justifyContent="center"><CircularProgress /></Box>}

      {desk && (
        <>
          {desk.autoResolved > 0 && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {desk.autoResolved} late-load warning{desk.autoResolved > 1 ? "s were" : " was"} closed automatically because the load was delivered.
            </Alert>
          )}
          {desk.cases.length === 0 && <Alert severity="success">Nothing needs you right now.</Alert>}

          <Stack spacing={1.5}>
            {desk.cases.map((c) => (
              <Paper key={`${c.kind}-${c.id}`} sx={{ p: 2 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-start" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" mb={0.5}>
                      <Chip size="small" label={KIND_LABEL[c.kind] || c.kind} />
                      <Chip size="small" color={SEVERITY_COLOR[c.severity] || "default"} variant="outlined" label={c.severity} />
                      <Typography variant="caption" color="text.secondary">waiting {age(c.ageHours)}</Typography>
                    </Stack>
                    <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>{c.title}</Typography>
                    {c.detail && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{c.detail}</Typography>}
                    <Alert severity={c.proposal.action === "review" ? "info" : "warning"} icon={false} sx={{ mt: 1, py: 0.5 }}>
                      <Typography variant="body2" fontWeight={700}>{ACTION_LABEL[c.proposal.action]}</Typography>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{c.proposal.reason}</Typography>
                    </Alert>
                  </Box>
                  {c.link && <Button variant="outlined" onClick={() => navigate(c.link)} sx={{ flexShrink: 0 }}>Open</Button>}
                </Stack>
              </Paper>
            ))}
          </Stack>

          {desk.accuracy.length > 0 && (
            <Paper sx={{ p: 2, mt: 3 }}>
              <Typography fontWeight={800} mb={0.5}>How often the rules matched your decision</Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                A rule is a candidate for automatic handling only after it has matched consistently over many cases.
              </Typography>
              {desk.accuracy.map((a) => (
                <Stack key={a.rule} direction="row" spacing={2} justifyContent="space-between" py={0.5}>
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{a.label}</Typography>
                  <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: "nowrap" }}>{a.agreed} of {a.decided}</Typography>
                </Stack>
              ))}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
