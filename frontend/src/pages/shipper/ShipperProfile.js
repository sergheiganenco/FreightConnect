import React, { useEffect, useState } from "react";
import {
  Box, Typography, Paper, Stack, TextField, Chip, Button,
  CircularProgress, Snackbar, Alert, Divider
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import api from "../../services/api";

// Define required docs for shipper
const SHIPPER_DOCS = [
  { key: "business_license", label: "Business License or IRS EIN Letter" }
  // Add more as needed
];

export default function ShipperProfile() {
  const [user, setUser] = useState(null);
  const [edit, setEdit] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  useEffect(() => {
    setLoading(true);
    api.get("/users/me")
      .then(({ data }) => {
        setUser(data);
        setEdit({
          name: data.name || "",
          email: data.email || "",
          companyName: data.companyName || "",
          phone: data.phone || ""
        });
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

  const handleUpload = async (key, file) => {
    setUploadBusy(prev => ({ ...prev, [key]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", key);
      const res = await api.post("/users/me/upload-doc", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
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
        <Stack direction="row" justifyContent="center" mb={2}>
          <Chip
            label="SHIPPER"
            color="primary"
            sx={{ fontWeight: 700, fontSize: "1em", letterSpacing: 1, px: 2, bgcolor: "#6366f1", color: "#fff" }}
          />
        </Stack>
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
        <Divider sx={{ my: 4, borderColor: "#bcbcff55" }} />
        <Typography variant="h6" fontWeight={700} color="#fff" mb={2}>
          Required Documents
        </Typography>
        <Stack spacing={2}>
          {SHIPPER_DOCS.map(doc => {
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
