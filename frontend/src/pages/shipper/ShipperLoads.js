import React, { useEffect, useState } from "react";
import {
  Box, Typography, Button, Grid, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Chip, Card, CardContent, CardActions, CircularProgress, MenuItem, Select
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import api from "../../services/api";

const statusColors = {
  open: "#3cf586",
  posted: "#3cf586",
  assigned: "#29B6F6",
  intransit: "#FFD600",
  delivered: "#A259F7",
  cancelled: "#F45B69"
};

const initialForm = {
  title: "",
  origin: "",
  destination: "",
  rate: "",
  equipmentType: "",
  notes: "",
};

function LoadDetailsModal({ open, onClose, load }) {
  if (!load) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Load Details</DialogTitle>
      <DialogContent dividers>
        <Typography><b>Title:</b> {load.title}</Typography>
        <Typography><b>Origin:</b> {load.origin}</Typography>
        <Typography><b>Destination:</b> {load.destination}</Typography>
        <Typography><b>Rate:</b> ${load.rate}</Typography>
        <Typography><b>Equipment:</b> {load.equipmentType}</Typography>
        <Typography><b>Status:</b> {load.status}</Typography>
        <Typography><b>Notes:</b> {load.notes || "-"}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ShipperLoads() {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [formEditId, setFormEditId] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const fetchLoads = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/loads/posted");
      setLoads(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError("Could not fetch loads.");
      setLoads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoads();
  }, []);

  // Filtering logic
  const filteredLoads =
    filter === "all"
      ? loads
      : loads.filter((load) => load.status && load.status.toLowerCase() === filter);

  // UI
  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h5" fontWeight={800} sx={{ color: "#fff", ml: 1 }}>
          Loads
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            size="small"
            sx={{
              bgcolor: "#211f3d",
              color: "#fff",
              borderRadius: 2,
              fontWeight: 700,
              fontSize: 15,
              px: 2,
              boxShadow: 2,
              "& .MuiSelect-icon": { color: "#A259F7" },
              mr: 2
            }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="posted">Posted</MenuItem>
            <MenuItem value="intransit">In-Transit</MenuItem>
            <MenuItem value="delivered">Delivered</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
          </Select>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setFormOpen(true)}
            sx={{
              background: "linear-gradient(90deg, #7F4DF3 20%, #1BACE0 100%)",
              color: "white",
              borderRadius: 3,
              px: 3,
              fontWeight: 700,
              boxShadow: 2,
              letterSpacing: 0.4
            }}
          >
            + Post New Load
          </Button>
        </Box>
      </Box>
      {loading && <CircularProgress />}
      {error && <Typography color="#f45b69">{error}</Typography>}

      <Grid container spacing={4}>
        {filteredLoads.map((load) => (
          <Grid item xs={12} sm={6} md={4} key={load._id}>
            <Card
              sx={{
                background: "rgba(255,255,255,0.15)",
                borderRadius: 5,
                boxShadow: "0 8px 32px 0 rgba(31,38,135,0.28)",
                border: "1px solid rgba(255,255,255,0.14)",
                color: "white",
                minHeight: 128,
                p: 0,
                transition: "box-shadow 0.22s",
                position: "relative",
                "&:hover": { boxShadow: "0 12px 40px 0 #a259f7" }
              }}
            >
              <CardContent sx={{ pb: 2, pt: 3 }}>
                <Typography
                  sx={{
                    fontWeight: 800,
                    fontSize: 19,
                    color: "#fff",
                    mb: 1
                  }}
                >
                  {load.origin} → {load.destination}
                </Typography>
                <Typography sx={{ fontSize: 16, color: "#fff", mb: 1 }}>
                  {load.title}
                </Typography>
                <Typography sx={{ fontSize: 15, color: "#eee" }}>
                  ${load.rate}
                </Typography>
                <Chip
                  label={load.status.charAt(0).toUpperCase() + load.status.slice(1)}
                  size="small"
                  sx={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    bgcolor: statusColors[load.status] || "#fff",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    px: 2,
                    letterSpacing: 0.5,
                    boxShadow: "0 2px 8px 0 #fff4"
                  }}
                />
              </CardContent>
              <CardActions sx={{ pl: 2, pb: 1 }}>
                <Button
                  size="small"
                  sx={{ color: "#A259F7", fontWeight: 700, px: 0.5 }}
                  onClick={() => {
                    setSelectedLoad(load);
                    setModalOpen(true);
                  }}
                >
                  Details
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* DETAILS MODAL */}
      <LoadDetailsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        load={selectedLoad}
      />

      {/* ADD/EDIT LOAD DIALOG */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Post New Load</DialogTitle>
        <DialogContent>
          <TextField margin="dense" fullWidth label="Title" name="title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <TextField margin="dense" fullWidth label="Origin" name="origin" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} />
          <TextField margin="dense" fullWidth label="Destination" name="destination" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} />
          <TextField margin="dense" fullWidth label="Rate" name="rate" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} type="number" />
          <TextField margin="dense" fullWidth label="Equipment Type" name="equipmentType" value={form.equipmentType} onChange={e => setForm({ ...form, equipmentType: e.target.value })} />
          <TextField margin="dense" fullWidth label="Notes" name="notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} multiline rows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              try {
                await api.post("/loads", form);
                setFormOpen(false);
                fetchLoads();
              } catch (e) {
                alert("Failed to post load.");
              }
            }}
            variant="contained"
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
