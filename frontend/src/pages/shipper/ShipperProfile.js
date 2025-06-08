import React, { useEffect, useState } from "react";
import { Box, Typography, TextField, Button, Paper } from "@mui/material";
import api from "../../services/api";

export default function ShipperProfile() {
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    api.get('/shipper/profile')
      .then(res => setProfile(res.data || { name: "", email: "" }))
      .catch(() => setProfile({ name: "", email: "" }));
  }, []);

  const handleChange = (e) => setProfile({ ...profile, [e.target.name]: e.target.value });
  const handleSave = async () => {
    await api.put('/shipper/profile', profile);
    setEdit(false);
  };

  return (
    <Paper elevation={2} sx={{ p: 4, width: "100%", maxWidth: 520 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>Profile</Typography>
      <TextField
        label="Name"
        name="name"
        value={profile.name}
        onChange={handleChange}
        disabled={!edit}
        sx={{ mb: 2, width: "100%" }}
      />
      <TextField
        label="Email"
        name="email"
        value={profile.email}
        onChange={handleChange}
        disabled={!edit}
        sx={{ mb: 3, width: "100%" }}
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        {edit ? (
          <Button variant="contained" onClick={handleSave}>Save</Button>
        ) : (
          <Button onClick={() => setEdit(true)} variant="outlined">Edit</Button>
        )}
      </Box>
    </Paper>
  );
}
