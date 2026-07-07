import React, { useEffect, useState } from "react";
import {
  Box, Paper, Typography, Button, TextField, CircularProgress, Chip, Stack, Alert,
} from "@mui/material";
import ShieldIcon from "@mui/icons-material/Shield";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import api from "../services/api";
import { brand, surface, text as T, tint, semantic } from "../theme/tokens";

/**
 * MFA / TOTP setup card.
 * - Reads current state from /users/me (mfaEnabled / twoFactorEnabled).
 * - Enable flow:  POST /users/mfa/setup -> show QR + secret -> POST /users/mfa/enable {token}.
 * - Disable flow: input code -> POST /users/mfa/disable {token}.
 * - Gracefully handles 503 (MFA unavailable on this environment).
 */
export default function MfaSetup() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // setup payload
  const [setup, setSetup] = useState(null); // { otpauthUrl, qr }
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // disable flow
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  useEffect(() => {
    let active = true;
    api.get("/users/me")
      .then((res) => {
        if (!active) return;
        setEnabled(Boolean(res.data?.mfaEnabled ?? res.data?.twoFactorEnabled));
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const handleSetup = async () => {
    setError(""); setInfo(""); setBusy(true);
    try {
      const res = await api.post("/users/mfa/setup");
      setSetup(res.data || {});
    } catch (err) {
      if (err?.response?.status === 503) setUnavailable(true);
      else setError(err?.response?.data?.error || "Could not start MFA setup.");
    }
    setBusy(false);
  };

  const handleEnable = async () => {
    setError(""); setInfo("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from your authenticator app."); return; }
    setBusy(true);
    try {
      await api.post("/users/mfa/enable", { token: code.trim() });
      setEnabled(true);
      setSetup(null);
      setCode("");
      setInfo("MFA enabled ✓");
    } catch (err) {
      setError(err?.response?.data?.error || "Invalid code. Please try again.");
    }
    setBusy(false);
  };

  const handleDisable = async () => {
    setError(""); setInfo("");
    if (!/^\d{6}$/.test(disableCode.trim())) { setError("Enter the 6-digit code to confirm disabling MFA."); return; }
    setBusy(true);
    try {
      await api.post("/users/mfa/disable", { token: disableCode.trim() });
      setEnabled(false);
      setDisabling(false);
      setDisableCode("");
      setInfo("MFA disabled.");
    } catch (err) {
      setError(err?.response?.data?.error || "Invalid code. Could not disable MFA.");
    }
    setBusy(false);
  };

  const cardSx = {
    borderRadius: 4,
    p: { xs: 2.5, sm: 3.5 },
    background: surface.indigoTint,
    border: `1px solid ${surface.indigoBorderLight}`,
    boxShadow: "0 4px 24px #1e034315",
  };

  const codeFieldSx = {
    "& .MuiInputBase-root": { color: T.primary, bgcolor: surface.glass, borderRadius: 2 },
    "& .MuiInputBase-input": { color: T.primary, letterSpacing: 6, fontWeight: 800 },
    "& .MuiInputLabel-root": { color: T.secondary },
  };

  if (loading) {
    return (
      <Paper elevation={0} sx={cardSx}>
        <Box display="flex" justifyContent="center" py={3}><CircularProgress size={28} /></Box>
      </Paper>
    );
  }

  return (
    <Paper elevation={0} sx={cardSx}>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1.5}>
        <ShieldIcon sx={{ color: brand.indigoLight }} />
        <Typography variant="h6" fontWeight={900} sx={{ color: T.primary, flex: 1 }}>
          Two-Factor Authentication (MFA)
        </Typography>
        <Chip
          size="small"
          label={enabled ? "ENABLED" : "DISABLED"}
          icon={enabled ? <VerifiedUserIcon sx={{ fontSize: 16, color: `${semantic.success} !important` }} /> : undefined}
          sx={{
            fontWeight: 800,
            bgcolor: enabled ? tint(semantic.success, 0.16) : tint(semantic.muted, 0.16),
            color: enabled ? semantic.success : semantic.muted,
          }}
        />
      </Stack>

      <Typography variant="body2" sx={{ color: T.secondary, mb: 2 }}>
        Protect your account with an authenticator app (Google Authenticator, Authy, 1Password).
      </Typography>

      {unavailable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          MFA is not available on this environment. Contact your administrator to enable it.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}

      {/* ── Enabled state ───────────────────────────────────────── */}
      {enabled && !unavailable && (
        <>
          {!disabling ? (
            <Button
              variant="outlined" color="error"
              onClick={() => { setDisabling(true); setError(""); setInfo(""); }}
              sx={{ fontWeight: 800, borderRadius: 99 }}
            >
              Disable MFA
            </Button>
          ) : (
            <Box>
              <Typography variant="body2" sx={{ color: T.secondary, mb: 1.5 }}>
                Enter the current 6-digit code from your authenticator app to confirm.
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                <TextField
                  size="small" label="6-digit code" value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  sx={{ ...codeFieldSx, width: 180 }}
                  inputProps={{ inputMode: "numeric", maxLength: 6 }}
                />
                <Button variant="contained" color="error" disabled={busy} onClick={handleDisable}
                  sx={{ fontWeight: 800, borderRadius: 99 }}>
                  {busy ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Confirm Disable"}
                </Button>
                <Button onClick={() => { setDisabling(false); setDisableCode(""); setError(""); }} sx={{ color: T.secondary }}>
                  Cancel
                </Button>
              </Stack>
            </Box>
          )}
        </>
      )}

      {/* ── Disabled state — setup flow ─────────────────────────── */}
      {!enabled && !unavailable && (
        <>
          {!setup ? (
            <Button
              variant="contained" disabled={busy} onClick={handleSetup}
              startIcon={!busy && <ShieldIcon />}
              sx={{ bgcolor: brand.indigo, fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#4338ca" } }}
            >
              {busy ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Enable MFA"}
            </Button>
          ) : (
            <Box>
              <Typography variant="body2" sx={{ color: T.secondary, mb: 1.5 }}>
                1. Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
              </Typography>

              {setup.qr ? (
                <Box
                  sx={{
                    display: "inline-block", p: 1.5, mb: 2, borderRadius: 3,
                    bgcolor: "#fff", border: `1px solid ${surface.glassBorder}`,
                  }}
                >
                  <img src={setup.qr} alt="MFA QR code" width={180} height={180} style={{ display: "block" }} />
                </Box>
              ) : (
                <Alert severity="info" sx={{ mb: 2 }}>
                  QR code unavailable — add this URL/secret manually in your authenticator:
                  <Box component="code" sx={{ display: "block", mt: 1, wordBreak: "break-all", fontSize: "0.8em" }}>
                    {setup.otpauthUrl || "(no secret returned)"}
                  </Box>
                </Alert>
              )}

              {setup.qr && setup.otpauthUrl && (
                <Typography variant="caption" sx={{ display: "block", color: T.muted, mb: 2, wordBreak: "break-all" }}>
                  Can&apos;t scan? Use this setup URL: {setup.otpauthUrl}
                </Typography>
              )}

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
                <TextField
                  size="small" label="6-digit code" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  sx={{ ...codeFieldSx, width: 180 }}
                  inputProps={{ inputMode: "numeric", maxLength: 6 }}
                />
                <Button variant="contained" disabled={busy} onClick={handleEnable}
                  sx={{ bgcolor: brand.indigo, fontWeight: 800, borderRadius: 99, "&:hover": { bgcolor: "#4338ca" } }}>
                  {busy ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Verify & Enable"}
                </Button>
                <Button onClick={() => { setSetup(null); setCode(""); setError(""); }} sx={{ color: T.secondary }}>
                  Cancel
                </Button>
              </Stack>
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}
