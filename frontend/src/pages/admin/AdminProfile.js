import React, { useEffect, useState } from "react";
import { Box, Paper, Typography, TextField, Button, CircularProgress, Snackbar, Alert, Divider } from "@mui/material";
import api from '../../services/api';

export default function AdminProfileSection() {
  const [profile, setProfile] = useState(null);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  useEffect(() => {
    api.get("/users/me")
      .then(res => {
        setProfile(res.data);
        setEdit({
          name: res.data.name || "",
          email: res.data.email || "",
          phone: res.data.phone || ""
        });
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put("/users/me", edit);
      setProfile(res.data);
      setSnackbar({ open: true, message: "Profile updated!", severity: "success" });
    } catch {
      setSnackbar({ open: true, message: "Update failed.", severity: "error" });
    }
    setSaving(false);
  };

  if (!profile) return <Box textAlign="center" pt={6}><CircularProgress /></Box>;

  return (
    <Box sx={{ py: 5, px: 2, minHeight: "90vh", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      <Paper sx={{
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
          Admin Profile
        </Typography>
        <TextField
          label="Full Name"
          name="name"
          value={edit.name}
          onChange={e => setEdit(p => ({ ...p, name: e.target.value }))}
          fullWidth
          variant="filled"
          InputProps={{
            sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 }
          }}
          InputLabelProps={{ sx: { color: "#bcbcff" } }}
          sx={{ mb: 3 }}
        />
        <TextField
          label="Email"
          name="email"
          value={edit.email}
          onChange={e => setEdit(p => ({ ...p, email: e.target.value }))}
          fullWidth
          variant="filled"
          InputProps={{
            sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 }
          }}
          InputLabelProps={{ sx: { color: "#bcbcff" } }}
          sx={{ mb: 3 }}
        />
        <TextField
          label="Phone"
          name="phone"
          value={edit.phone}
          onChange={e => setEdit(p => ({ ...p, phone: e.target.value }))}
          fullWidth
          variant="filled"
          InputProps={{
            sx: { bgcolor: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 3 }
          }}
          InputLabelProps={{ sx: { color: "#bcbcff" } }}
        />
        <Button
          onClick={handleSave}
          disabled={saving}
          sx={{
            mt: 4, bgcolor: "#6366f1", color: "#fff", px: 4, fontWeight: 900,
            borderRadius: 99, fontSize: "1.1em", boxShadow: "0 2px 8px #6366F160",
            "&:hover": { bgcolor: "#4338ca" }
          }}
          size="large"
        >
          {saving ? <CircularProgress size={24} sx={{ color: "#fff" }} /> : "Save"}
        </Button>
        <Divider sx={{ my: 4, borderColor: "#bcbcff55" }} />
        <Typography variant="h6" color="#fff" mb={2}>Activity Log (Coming Soon)</Typography>
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
