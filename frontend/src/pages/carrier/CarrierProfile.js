import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, Paper, Stack, TextField, Chip, Button,
  CircularProgress, Snackbar, Alert, Divider, InputAdornment,
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import VerifiedIcon from "@mui/icons-material/Verified";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import TuneIcon from "@mui/icons-material/Tune";
import AddIcon from "@mui/icons-material/Add";
import PaymentIcon from "@mui/icons-material/Payment";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import api from "../../services/api";
import TrustScoreBadge from "../../components/TrustScoreBadge";

const EQUIPMENT_TYPES = [
  "Dry Van", "Flatbed", "Reefer", "Step Deck", "Lowboy",
  "Tanker", "Box Truck", "Power Only", "Conestoga", "RGN",
];

const REGIONS = [
  "Northeast", "Southeast", "Midwest", "Southwest", "West Coast",
  "Mountain West", "Great Plains", "Pacific Northwest",
];

// Define required docs by role
const CARRIER_DOCS = [
  { key: "insurance", label: "Proof of Insurance" },
  { key: "authority", label: "Operating Authority (MC Certificate)" }
  // Add more as needed
];
const SHIPPER_DOCS = [
  { key: "business_license", label: "Business License or IRS EIN" }
  // Add more as needed
];

const VERIFICATION_STATUS_CONFIG = {
  unverified: {
    severity: "warning",
    icon: <ErrorOutlineIcon fontSize="small" />,
    message: "Your account is not yet verified. Verified carriers get priority on load matching.",
    cta: "Get Verified Now",
  },
  pending: {
    severity: "info",
    icon: <HourglassEmptyIcon fontSize="small" />,
    message: "Your verification is under review. We'll notify you once it's complete.",
    cta: null,
  },
  verified: {
    severity: "success",
    icon: <VerifiedIcon fontSize="small" />,
    message: "Your account is verified. You have full access to all loads.",
    cta: null,
  },
  rejected: {
    severity: "error",
    icon: <ErrorOutlineIcon fontSize="small" />,
    message: "Your verification was rejected. Please re-submit with valid documents.",
    cta: "Re-submit Verification",
  },
  suspended: {
    severity: "error",
    icon: <ErrorOutlineIcon fontSize="small" />,
    message: "Your account has been suspended. Contact support for assistance.",
    cta: null,
  },
};

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [edit, setEdit] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const userId = localStorage.getItem("userId");

  // ── Preferences state ────────────────────────────────────────────
  const [prefs, setPrefs] = useState({
    equipmentTypes: [],
    preferredRegions: [],
    preferredLanes: [],
    minRate: "",
    maxMileage: "",
    homeBase: { city: "", state: "" },
  });
  const [prefSaving, setPrefSaving] = useState(false);
  const [laneInput, setLaneInput] = useState({ origin: "", destination: "" });

  // ── Stripe Connect state ─────────────────────────────────────────
  const [stripeStatus, setStripeStatus] = useState(null); // null | {connected, payoutsEnabled}
  const [stripeLoading, setStripeLoading] = useState(false);
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/users/me")
      .then(({ data }) => {
        setUser(data);
        setEdit({
          name: data.name || "",
          email: data.email || "",
          companyName: data.companyName || "",
          mcNumber: data.mcNumber || "",
          dotNumber: data.dotNumber || "",
          phone: data.phone || ""
        });
        if (data.preferences) {
          setPrefs({
            equipmentTypes: data.preferences.equipmentTypes || [],
            preferredRegions: data.preferences.preferredRegions || [],
            preferredLanes: data.preferences.preferredLanes || [],
            minRate: data.preferences.minRate || "",
            maxMileage: data.preferences.maxMileage || "",
            homeBase: data.preferences.homeBase || { city: "", state: "" },
          });
        }
        if (data.role === "carrier") {
          // Fetch Stripe Connect status after profile loads
          api.get("/payments/connect/status")
            .then(({ data: s }) => setStripeStatus(s))
            .catch(() => setStripeStatus({ connected: false, payoutsEnabled: false }));
        }
      })
      .catch(() => setSnackbar({ open: true, message: "Failed to load profile.", severity: "error" }))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = e => {
    setEdit(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put("/users/me", edit);
      setUser(res.data);
      setSnackbar({ open: true, message: "Profile updated!", severity: "success" });
    } catch {
      setSnackbar({ open: true, message: "Update failed.", severity: "error" });
    }
    setSaving(false);
  };

  const handleSavePrefs = async () => {
    setPrefSaving(true);
    try {
      await api.put("/users/me/preferences", {
        ...prefs,
        minRate: prefs.minRate ? Number(prefs.minRate) : 0,
        maxMileage: prefs.maxMileage ? Number(prefs.maxMileage) : null,
      });
      setSnackbar({ open: true, message: "Preferences saved!", severity: "success" });
    } catch {
      setSnackbar({ open: true, message: "Failed to save preferences.", severity: "error" });
    }
    setPrefSaving(false);
  };

  const fetchStripeStatus = async () => {
    setStripeLoading(true);
    try {
      const { data } = await api.get("/payments/connect/status");
      setStripeStatus(data);
    } catch {
      setStripeStatus({ connected: false, payoutsEnabled: false });
    }
    setStripeLoading(false);
  };

  const handleStripeOnboard = async () => {
    setOnboarding(true);
    try {
      const { data } = await api.post("/payments/connect/onboard");
      window.location.href = data.url;
    } catch (err) {
      setSnackbar({ open: true, message: err.response?.data?.error || "Failed to start onboarding", severity: "error" });
      setOnboarding(false);
    }
  };

  const toggleEquip = (eq) =>
    setPrefs((p) => ({
      ...p,
      equipmentTypes: p.equipmentTypes.includes(eq)
        ? p.equipmentTypes.filter((e) => e !== eq)
        : [...p.equipmentTypes, eq],
    }));

  const toggleRegion = (r) =>
    setPrefs((p) => ({
      ...p,
      preferredRegions: p.preferredRegions.includes(r)
        ? p.preferredRegions.filter((x) => x !== r)
        : [...p.preferredRegions, r],
    }));

  const addLane = () => {
    if (!laneInput.origin.trim() || !laneInput.destination.trim()) return;
    setPrefs((p) => ({
      ...p,
      preferredLanes: [...p.preferredLanes, { origin: laneInput.origin.trim(), destination: laneInput.destination.trim() }],
    }));
    setLaneInput({ origin: "", destination: "" });
  };

  const removeLane = (idx) =>
    setPrefs((p) => ({ ...p, preferredLanes: p.preferredLanes.filter((_, i) => i !== idx) }));

  const handleUpload = async (key, file) => {
    setUploadBusy(prev => ({ ...prev, [key]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", key);
      const res = await api.post("/users/me/upload-doc", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      // update user's documents
      setUser(u => ({
        ...u,
        documents: {
          ...u.documents,
          [key]: res.data
        }
      }));
      setSnackbar({ open: true, message: `${key.replace("_", " ")} uploaded!`, severity: "success" });
    } catch {
      setSnackbar({ open: true, message: `Upload failed.`, severity: "error" });
    }
    setUploadBusy(prev => ({ ...prev, [key]: false }));
  };

  if (loading || !user) {
    return (
      <Box minHeight="50vh" display="flex" alignItems="center" justifyContent="center">
        <CircularProgress size={38} />
      </Box>
    );
  }

  const docFields = user.role === "carrier" ? CARRIER_DOCS : SHIPPER_DOCS;

  return (
    <Box sx={{ py: 5, px: 2, minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      <Paper
        sx={{
          minWidth: { xs: "97vw", sm: 420 }, maxWidth: 520,
          mx: "auto", py: 4, px: { xs: 2, sm: 5 },
          borderRadius: 6,
          boxShadow: "0 8px 40px 0 #1e034330",
          background: "rgba(124,140,248,0.14)",
          backdropFilter: "blur(12px)",
          border: "1.5px solid rgba(124,140,248,0.18)",
        }}
        elevation={0}
      >
        <Typography variant="h4" fontWeight={900} align="center" mb={2} color="#fff" letterSpacing={1.5}>
          Profile
        </Typography>

        {/* Role chip + Trust Score Badge */}
        <Stack direction="row" justifyContent="center" alignItems="center" spacing={2} mb={2}>
          <Chip
            label={user?.role?.toUpperCase() || "USER"}
            color={user?.role === "shipper" ? "primary" : "secondary"}
            sx={{ fontWeight: 700, fontSize: "1em", letterSpacing: 1, px: 2 }}
          />
          {(() => {
            const status = user.verification?.status || "unverified";
            const cfg = VERIFICATION_STATUS_CONFIG[status];
            return cfg ? (
              <Chip
                icon={cfg.icon}
                label={status.charAt(0).toUpperCase() + status.slice(1)}
                color={cfg.severity}
                variant="outlined"
                sx={{ fontWeight: 700 }}
              />
            ) : null;
          })()}
          {user.role === "carrier" && userId && (
            <TrustScoreBadge userId={userId} size="md" />
          )}
        </Stack>

        {/* Verification status banner (carriers only) */}
        {user.role === "carrier" && (() => {
          const status = user.verification?.status || "unverified";
          const cfg = VERIFICATION_STATUS_CONFIG[status];
          if (!cfg) return null;
          return (
            <Alert
              severity={cfg.severity}
              icon={cfg.icon}
              sx={{ mb: 3, borderRadius: 2, alignItems: "center" }}
              action={cfg.cta ? (
                <Button
                  size="small"
                  variant="outlined"
                  color={cfg.severity}
                  onClick={() => navigate("/dashboard/carrier/verification")}
                  sx={{ whiteSpace: "nowrap", fontWeight: 700 }}
                >
                  {cfg.cta}
                </Button>
              ) : undefined}
            >
              {cfg.message}
            </Alert>
          );
        })()}
        <Stack spacing={3} alignItems="stretch" sx={{ mt: 2 }}>
          <TextField
            label="Full Name"
            name="name"
            value={edit.name}
            onChange={handleChange}
            fullWidth
            variant="filled"
            InputProps={{
              sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 }
            }}
            InputLabelProps={{ sx: { color: "#bcbcff" } }}
          />
          <TextField
            label="Email"
            name="email"
            value={edit.email}
            onChange={handleChange}
            fullWidth
            variant="filled"
            InputProps={{
              sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 }
            }}
            InputLabelProps={{ sx: { color: "#bcbcff" } }}
          />
          {/* Carrier-specific fields */}
          {user.role === "carrier" && (
            <>
              <TextField
                label="Company Name"
                name="companyName"
                value={edit.companyName}
                onChange={handleChange}
                fullWidth
                variant="filled"
                InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
                InputLabelProps={{ sx: { color: "#bcbcff" } }}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="MC Number"
                  name="mcNumber"
                  value={edit.mcNumber}
                  onChange={handleChange}
                  fullWidth
                  variant="filled"
                  InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                />
                <TextField
                  label="DOT Number"
                  name="dotNumber"
                  value={edit.dotNumber}
                  onChange={handleChange}
                  fullWidth
                  variant="filled"
                  InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                />
              </Stack>
            </>
          )}
          {/* Shipper-specific fields */}
          {user.role === "shipper" && (
            <TextField
              label="Company Name"
              name="companyName"
              value={edit.companyName}
              onChange={handleChange}
              fullWidth
              variant="filled"
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
              InputLabelProps={{ sx: { color: "#bcbcff" } }}
            />
          )}
          <TextField
            label="Phone"
            name="phone"
            value={edit.phone}
            onChange={handleChange}
            fullWidth
            variant="filled"
            InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
            InputLabelProps={{ sx: { color: "#bcbcff" } }}
          />
        </Stack>
        <Stack direction="row" spacing={2} justifyContent="center" mt={4}>
          <Button
            onClick={handleSave}
            disabled={saving}
            sx={{
              bgcolor: "#6366f1",
              color: "#fff",
              px: 4,
              fontWeight: 900,
              borderRadius: 99,
              fontSize: "1.1em",
              boxShadow: "0 2px 8px #6366F160",
              "&:hover": { bgcolor: "#4338ca" }
            }}
            size="large"
          >
            {saving ? <CircularProgress size={24} sx={{ color: "#fff" }} /> : "Save"}
          </Button>
        </Stack>
        {/* ── Carrier Matching Preferences ── */}
        {user.role === "carrier" && (
          <>
            <Divider sx={{ my: 4, borderColor: "#bcbcff55" }} />
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <TuneIcon sx={{ color: "#bcbcff" }} />
              <Typography variant="h6" fontWeight={700} color="#fff">
                Matching Preferences
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.45)", mb: 2 }}>
              We use these to find loads that are the best fit for you.
            </Typography>
            <Stack spacing={3}>
              {/* Equipment types */}
              <Box>
                <Typography variant="caption" sx={{ color: "#bcbcff", mb: 1, display: "block" }}>
                  Equipment Types
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {EQUIPMENT_TYPES.map((eq) => (
                    <Chip
                      key={eq}
                      label={eq}
                      onClick={() => toggleEquip(eq)}
                      sx={{
                        bgcolor: prefs.equipmentTypes.includes(eq) ? "#6366f1" : "rgba(255,255,255,0.08)",
                        color: "#fff",
                        fontWeight: prefs.equipmentTypes.includes(eq) ? 700 : 400,
                        cursor: "pointer",
                        "&:hover": { bgcolor: prefs.equipmentTypes.includes(eq) ? "#4338ca" : "rgba(255,255,255,0.15)" },
                      }}
                    />
                  ))}
                </Box>
              </Box>

              {/* Preferred regions */}
              <Box>
                <Typography variant="caption" sx={{ color: "#bcbcff", mb: 1, display: "block" }}>
                  Preferred Regions
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {REGIONS.map((r) => (
                    <Chip
                      key={r}
                      label={r}
                      onClick={() => toggleRegion(r)}
                      sx={{
                        bgcolor: prefs.preferredRegions.includes(r) ? "#6366f1" : "rgba(255,255,255,0.08)",
                        color: "#fff",
                        fontWeight: prefs.preferredRegions.includes(r) ? 700 : 400,
                        cursor: "pointer",
                        "&:hover": { bgcolor: prefs.preferredRegions.includes(r) ? "#4338ca" : "rgba(255,255,255,0.15)" },
                      }}
                    />
                  ))}
                </Box>
              </Box>

              {/* Rate + mileage */}
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Min Rate ($)"
                  type="number"
                  value={prefs.minRate}
                  onChange={(e) => setPrefs((p) => ({ ...p, minRate: e.target.value }))}
                  variant="filled"
                  InputProps={{
                    sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 },
                    startAdornment: <InputAdornment position="start"><Typography sx={{ color: "#bcbcff" }}>$</Typography></InputAdornment>,
                  }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                  fullWidth
                />
                <TextField
                  label="Max Mileage"
                  type="number"
                  value={prefs.maxMileage}
                  onChange={(e) => setPrefs((p) => ({ ...p, maxMileage: e.target.value }))}
                  variant="filled"
                  InputProps={{
                    sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 },
                    endAdornment: <InputAdornment position="end"><Typography sx={{ color: "#bcbcff" }}>mi</Typography></InputAdornment>,
                  }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                  fullWidth
                />
              </Stack>

              {/* Home base */}
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Home Base City"
                  value={prefs.homeBase?.city || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, homeBase: { ...p.homeBase, city: e.target.value } }))}
                  variant="filled"
                  InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                  fullWidth
                />
                <TextField
                  label="State"
                  value={prefs.homeBase?.state || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, homeBase: { ...p.homeBase, state: e.target.value } }))}
                  variant="filled"
                  inputProps={{ maxLength: 2 }}
                  InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 } }}
                  InputLabelProps={{ sx: { color: "#bcbcff" } }}
                  sx={{ maxWidth: 120 }}
                />
              </Stack>

              {/* Preferred lanes */}
              <Box>
                <Typography variant="caption" sx={{ color: "#bcbcff", mb: 1, display: "block" }}>
                  Preferred Lanes
                </Typography>
                <Stack direction="row" spacing={1} mb={1}>
                  <TextField
                    placeholder="Origin (city / state)"
                    value={laneInput.origin}
                    onChange={(e) => setLaneInput((l) => ({ ...l, origin: e.target.value }))}
                    size="small"
                    variant="filled"
                    InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.10)", color: "#fff", borderRadius: 2 } }}
                  />
                  <TextField
                    placeholder="Destination"
                    value={laneInput.destination}
                    onChange={(e) => setLaneInput((l) => ({ ...l, destination: e.target.value }))}
                    size="small"
                    variant="filled"
                    InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.10)", color: "#fff", borderRadius: 2 } }}
                  />
                  <Button
                    onClick={addLane}
                    variant="contained"
                    size="small"
                    startIcon={<AddIcon />}
                    sx={{ bgcolor: "#6366f1", borderRadius: 9999, "&:hover": { bgcolor: "#4338ca" } }}
                  >
                    Add
                  </Button>
                </Stack>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {prefs.preferredLanes.map((l, i) => (
                    <Chip
                      key={i}
                      label={`${l.origin} → ${l.destination}`}
                      onDelete={() => removeLane(i)}
                      sx={{ bgcolor: "rgba(99,102,241,0.25)", color: "#fff" }}
                      size="small"
                    />
                  ))}
                </Box>
              </Box>

              <Stack direction="row" justifyContent="flex-end">
                <Button
                  onClick={handleSavePrefs}
                  disabled={prefSaving}
                  variant="contained"
                  sx={{ bgcolor: "#6366f1", borderRadius: 99, px: 4, fontWeight: 700, "&:hover": { bgcolor: "#4338ca" } }}
                >
                  {prefSaving ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Save Preferences"}
                </Button>
              </Stack>
            </Stack>
          </>
        )}

        {/* ── Stripe Payout Setup ── */}
        {user.role === "carrier" && (
          <>
            <Divider sx={{ my: 4, borderColor: "#bcbcff55" }} />
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
              <PaymentIcon sx={{ color: "#bcbcff" }} />
              <Typography variant="h6" fontWeight={700} color="#fff">Payout Setup</Typography>
            </Stack>
            {stripeLoading && <CircularProgress size={20} />}
            {!stripeLoading && stripeStatus && (
              <Box
                sx={{
                  p: 2.5, borderRadius: 3, mb: 2,
                  bgcolor: stripeStatus.payoutsEnabled ? "rgba(52,211,153,0.08)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${stripeStatus.payoutsEnabled ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.1)"}`,
                }}
              >
                {stripeStatus.payoutsEnabled ? (
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <CheckCircleIcon sx={{ color: "#34d399", fontSize: 28 }} />
                    <Box>
                      <Typography fontWeight={700} color="#fff">Payouts Enabled</Typography>
                      <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)" }}>
                        You'll receive payments directly to your bank account after each delivery.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      endIcon={<OpenInNewIcon />}
                      onClick={handleStripeOnboard}
                      sx={{ ml: "auto", color: "#bcbcff", borderColor: "rgba(255,255,255,0.2)", borderRadius: 9999, whiteSpace: "nowrap" }}
                    >
                      Manage
                    </Button>
                  </Stack>
                ) : (
                  <Stack spacing={1.5}>
                    <Typography fontWeight={700} color="#fff">Set Up Your Payout Account</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)" }}>
                      Connect your bank account to receive payments for completed loads. Powered by Stripe.
                    </Typography>
                    <Button
                      variant="contained"
                      disabled={onboarding}
                      onClick={handleStripeOnboard}
                      startIcon={onboarding ? <CircularProgress size={16} /> : <PaymentIcon />}
                      sx={{
                        alignSelf: "flex-start",
                        bgcolor: "#6366f1", borderRadius: 99, fontWeight: 700,
                        "&:hover": { bgcolor: "#4338ca" },
                      }}
                    >
                      {onboarding ? "Redirecting…" : "Connect Bank Account"}
                    </Button>
                  </Stack>
                )}
              </Box>
            )}
          </>
        )}

        <Divider sx={{ my: 4, borderColor: "#bcbcff55" }} />
        <Typography variant="h6" fontWeight={700} color="#fff" mb={2}>
          Required Documents
        </Typography>
        <Stack spacing={2}>
          {docFields.map(doc => {
            const docInfo = user.documents?.[doc.key] || {};
            return (
              <Box
                key={doc.key}
                sx={{
                  display: "flex", alignItems: "center", gap: 2,
                  bgcolor: "rgba(255,255,255,0.05)", borderRadius: 3, px: 2, py: 2
                }}
              >
                <DescriptionIcon sx={{ fontSize: 30, color: "#fff" }} />
                <Typography sx={{ flex: 1, color: "#fff", fontWeight: 700 }}>
                  {doc.label}
                </Typography>
                <Chip
                  label={docInfo.uploaded ? "Uploaded" : "Missing"}
                  sx={{
                    bgcolor: docInfo.uploaded ? "#34D399" : "#F87171",
                    color: "#fff", fontWeight: 700, px: 2, fontSize: "1.03em"
                  }}
                />
                {docInfo.uploaded && docInfo.url && (
                  <Button
                    href={docInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="contained"
                    size="small"
                    sx={{
                      ml: 1, bgcolor: "#6366f1", color: "#fff", fontWeight: 700,
                      borderRadius: 8, px: 2,
                      "&:hover": { bgcolor: "#4338ca" }
                    }}
                  >
                    View
                  </Button>
                )}
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  disabled={uploadBusy[doc.key]}
                  startIcon={<CloudUploadIcon />}
                  sx={{
                    ml: 1, borderColor: "#6366f1", color: "#6366f1",
                    borderRadius: 8, fontWeight: 700,
                    "&:hover": { bgcolor: "#e9e6fc", borderColor: "#4338ca" }
                  }}
                >
                  {uploadBusy[doc.key] ? <CircularProgress size={18} /> : (docInfo.uploaded ? "Replace" : "Upload")}
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    hidden
                    onChange={e => {
                      if (e.target.files && e.target.files[0]) {
                        handleUpload(doc.key, e.target.files[0]);
                        e.target.value = ""; // reset for re-upload
                      }
                    }}
                  />
                </Button>
              </Box>
            );
          })}
        </Stack>
      </Paper>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
