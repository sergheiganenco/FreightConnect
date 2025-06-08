import React, { useEffect, useState } from "react";
import {
  Box, Typography, Card, CardContent, CardActions, Button, Grid, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip, Chip,
  CircularProgress, MenuItem
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import AssignmentIcon from "@mui/icons-material/Assignment";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import UndoIcon from "@mui/icons-material/Undo";
import api from "../services/api";
import socket from "../services/socket";

// Status color mapping
const statusColors = {
  Available: "success",
  Assigned: "info",
  "At Pickup": "info",
  Loading: "warning",
  "In Transit": "primary",
  "At Delivery": "info",
  Delivered: "success",
  Maintenance: "secondary",
  Offline: "default",
};

export default function CarrierFleet() {
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTruck, setEditTruck] = useState(null);
  const [form, setForm] = useState({ truckId: "", driverName: "", status: "Available" });
  const [submitting, setSubmitting] = useState(false);

  const [openLoads, setOpenLoads] = useState([]);
  const [assignModal, setAssignModal] = useState({ open: false, truck: null });
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [assignError, setAssignError] = useState(null);

  // Assigned load modal state
  const [viewLoadModal, setViewLoadModal] = useState({ open: false, load: null });

  useEffect(() => {
    socket.on("fleetUpdated", fetchFleet);
    return () => socket.off("fleetUpdated", fetchFleet);
  }, []);

  useEffect(() => {
    fetchFleet();
    fetchOpenLoads();
    // eslint-disable-next-line
  }, []);

  async function fetchFleet() {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const { data } = await api.get("/users/fleet", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setFleet(data.fleet || []);
    } catch (err) { /* Optionally: error handling */ }
    setLoading(false);
  }

  async function fetchOpenLoads() {
    try {
      const token = localStorage.getItem("token");
      const { data } = await api.get("/loads?status=open", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOpenLoads(data);
    } catch (err) { /* Optionally: error handling */ }
  }

  // Fetch assigned load by ID if not populated
  async function fetchLoadById(loadId) {
    const token = localStorage.getItem("token");
    const { data } = await api.get(`/loads/${loadId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return data;
  }

  // --- TRUCK CRUD ---
  function handleDialogOpen(truck) {
    if (truck) {
      setEditTruck(truck);
      setForm({
        truckId: truck.truckId,
        driverName: truck.driverName || "",
        status: truck.status || "Available",
      });
    } else {
      setEditTruck(null);
      setForm({ truckId: "", driverName: "", status: "Available" });
    }
    setDialogOpen(true);
  }

  function handleDialogClose() {
    setDialogOpen(false);
    setEditTruck(null);
    setForm({ truckId: "", driverName: "", status: "Available" });
  }

  function handleFormChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSave() {
    setSubmitting(true);
    const token = localStorage.getItem("token");
    try {
      if (editTruck) {
        await api.put(`/users/fleet/${editTruck.truckId}`, form, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await api.post("/users/fleet", form, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await fetchFleet();
      handleDialogClose();
    } catch (err) { /* Optionally: error handling */ }
    setSubmitting(false);
  }

  async function handleDelete(truckId) {
    if (!window.confirm("Remove this truck from your fleet?")) return;
    const token = localStorage.getItem("token");
    try {
      await api.delete(`/users/fleet/${truckId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFleet((prev) => prev.filter((t) => t.truckId !== truckId));
    } catch (err) { /* Optionally: error handling */ }
  }

  // --- ASSIGN/UNASSIGN ---
  function openAssignModal(truck) {
    setAssignError(null);
    setSelectedLoad(null);
    setAssignModal({ open: true, truck });
  }
  function closeAssignModal() {
    setAssignModal({ open: false, truck: null });
    setAssignError(null);
    setSelectedLoad(null);
  }

  async function handleAssign(loadId) {
    if (!assignModal.truck) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const token = localStorage.getItem("token");
      const { data } = await api.put(`/users/fleet/${assignModal.truck.truckId}/assign-load`, { loadId }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.fleet) setFleet(data.fleet);
      else await fetchFleet();
      await fetchOpenLoads();
      closeAssignModal();
    } catch (err) {
      setAssignError(err.response?.data?.error || "Failed to assign load.");
    }
    setAssigning(false);
  }

  async function handleUnassign(truckId) {
    setUnassigning(true);
    setAssignError(null);
    try {
      const token = localStorage.getItem("token");
      const { data } = await api.put(`/users/fleet/${truckId}/unassign-load`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.fleet) setFleet(data.fleet);
      else await fetchFleet();
      await fetchOpenLoads();
    } catch (err) {
      setAssignError(err.response?.data?.error || "Failed to unassign load.");
    }
    setUnassigning(false);
  }

  // --- MOVE SIMULATION ---
  async function handleMove(truck) {
    // Demo: randomize lat/lng
    const lat = (35 + Math.random() * 10).toFixed(5);
    const lng = (-80 + Math.random() * 10).toFixed(5);
    const token = localStorage.getItem("token");
    try {
      await api.put("/users/update-location", {
        latitude: lat,
        longitude: lng,
        truckId: truck.truckId
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchFleet();
    } catch (err) { /* Optionally: error handling */ }
  }

  // --- UI ---
  return (
    <Box sx={{ pt: 4, maxWidth: 1400, mx: "auto", width: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: "#fff", flex: 1 }}>
          Fleet / My Trucks
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleDialogOpen(null)}
          sx={{
            bgcolor: "primary.main",
            boxShadow: 3,
            borderRadius: 3,
            fontWeight: 600,
          }}
        >
          Add Truck
        </Button>
      </Box>

      {loading ? (
        <CircularProgress sx={{ color: "#fff", mt: 4 }} />
      ) : fleet.length === 0 ? (
        <Typography sx={{ color: "#eee" }}>No trucks in your fleet yet.</Typography>
      ) : (
        <Grid container spacing={3} alignItems="stretch">
          {fleet.map((truck) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={truck.truckId} sx={{ display: "flex" }}>
              <Card
                sx={{
                  bgcolor: "rgba(255,255,255,0.10)",
                  color: "#fff",
                  borderRadius: 3,
                  boxShadow: 4,
                  minHeight: 220,
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  backdropFilter: "blur(6px)",
                  justifyContent: "space-between",
                }}
              >
                <CardContent sx={{ pb: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <DirectionsCarIcon sx={{ mr: 1, color: "#fff" }} />
                    <Typography
                      variant="h6"
                      fontWeight={700}
                      sx={{
                        color: "#fff",
                        fontSize: "1.2rem",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        mr: 2,
                      }}
                    >
                      {truck.truckId}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1, color: "#fff" }}>
                    Driver: {truck.driverName || <i>Unassigned</i>}
                  </Typography>
                  <Chip
                    label={truck.status}
                    color={statusColors[truck.status] || "default"}
                    size="small"
                    sx={{ fontWeight: 700, mb: 1, color: "#fff" }}
                  />

                  {/* Assigned load info - always shows chip if assignedLoad or assignedLoadId exists */}
                  {(truck.assignedLoad || truck.assignedLoadId) && (
                    <Box sx={{ mt: 1 }}>
                      <Tooltip title="Click for load details">
                        <Chip
                          label={
                            truck.assignedLoad
                              ? `${truck.assignedLoad.origin} → ${truck.assignedLoad.destination}${
                                  truck.assignedLoad.equipmentType
                                    ? ` (${truck.assignedLoad.equipmentType})`
                                    : ""
                                }`
                              : "View Assigned Load"
                          }
                          color="info"
                          onClick={async () => {
                            let load = truck.assignedLoad;
                            if (!load && truck.assignedLoadId) {
                              load = await fetchLoadById(truck.assignedLoadId);
                            }
                            setViewLoadModal({ open: true, load });
                          }}
                          clickable
                          sx={{ fontWeight: 600, color: "#fff", mb: 1, cursor: "pointer" }}
                        />
                      </Tooltip>
                    </Box>
                  )}

                  {/* Location info */}
                  <Typography variant="body2" sx={{ mt: 1, color: "#fff" }}>
                    {truck.location && truck.location.latitude
                      ? `Lat: ${truck.location.latitude}, Lng: ${truck.location.longitude}`
                      : "No location"}
                  </Typography>
                </CardContent>
                <CardActions
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    gap: 1,
                    p: 1,
                    pt: 2,
                    borderTop: "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <Tooltip title="Edit Truck">
                    <span>
                      <IconButton onClick={() => handleDialogOpen(truck)} size="small">
                        <EditIcon sx={{ color: "#fff" }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Remove Truck">
                    <span>
                      <IconButton onClick={() => handleDelete(truck.truckId)} size="small">
                        <DeleteIcon sx={{ color: "#fff" }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Move Truck (simulate)">
                    <span>
                      <IconButton onClick={() => handleMove(truck)} size="small">
                        <LocationOnIcon sx={{ color: "#fff" }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {/* Only show assign if no load assigned */}
                  {!truck.assignedLoad && !truck.assignedLoadId && (
                    <Tooltip title="Assign Load">
                      <span>
                        <IconButton
                          color="primary"
                          onClick={() => openAssignModal(truck)}
                          size="small"
                          disabled={openLoads.length === 0}
                        >
                          <AssignmentIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {/* Show unassign if assigned */}
                  {(truck.assignedLoad || truck.assignedLoadId) && (
                    <Tooltip title="Unassign Load">
                      <span>
                        <IconButton
                          color="error"
                          onClick={() => handleUnassign(truck.truckId)}
                          size="small"
                          disabled={unassigning}
                        >
                          <UndoIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Add/Edit Truck Dialog */}
      <Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ bgcolor: "primary.main", color: "#fff" }}>
          {editTruck ? "Edit Truck" : "Add New Truck"}
        </DialogTitle>
        <DialogContent sx={{ bgcolor: "#232f3e" }}>
          <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              name="truckId"
              label="Truck ID / Number"
              value={form.truckId}
              onChange={handleFormChange}
              required
              disabled={!!editTruck}
              autoFocus
              InputProps={{
                sx: {
                  bgcolor: "rgba(255,255,255,0.25)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "1.1rem",
                  letterSpacing: 1,
                  "& input": {
                    color: "#fff",
                  },
                  "& .Mui-disabled": {
                    color: "#fff",
                    WebkitTextFillColor: "#fff",
                    opacity: 1,
                  },
                },
              }}
              InputLabelProps={{
                sx: {
                  color: "#fff",
                  opacity: 0.85,
                  fontWeight: 700,
                },
              }}
            />
            <TextField
              name="driverName"
              label="Driver Name"
              value={form.driverName}
              onChange={handleFormChange}
              InputProps={{
                sx: {
                  bgcolor: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  "& input": { color: "#fff" },
                },
              }}
              InputLabelProps={{
                sx: { color: "#fff", opacity: 0.85, fontWeight: 700 },
              }}
            />
            <TextField
              name="status"
              label="Status"
              value={form.status}
              onChange={handleFormChange}
              select
              InputProps={{
                sx: {
                  bgcolor: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  "& select": { color: "#fff" },
                },
              }}
              InputLabelProps={{
                sx: { color: "#fff", opacity: 0.85, fontWeight: 700 },
              }}
            >
              {Object.keys(statusColors).map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions sx={{ bgcolor: "#232f3e" }}>
          <Button onClick={handleDialogClose} color="secondary">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={submitting || !form.truckId}
          >
            {editTruck ? "Save Changes" : "Add Truck"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Load Modal */}
      <Dialog open={assignModal.open} onClose={closeAssignModal} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Load to {assignModal.truck?.truckId}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {openLoads.length === 0
              ? "No available loads to assign."
              : "Select a load below. Click 'View' to see load details before assigning."}
          </Typography>
          {assignError && (
            <Typography color="error" sx={{ mb: 2 }}>
              {assignError}
            </Typography>
          )}
          <Grid container spacing={2}>
            {openLoads.map((load) => (
              <Grid item xs={12} sm={6} key={load._id}>
                <Card
                  sx={{
                    bgcolor: "#24334a",
                    color: "#fff",
                    borderRadius: 2,
                    boxShadow: 2,
                    mb: 2,
                  }}
                  variant={selectedLoad?._id === load._id ? "outlined" : "elevation"}
                >
                  <CardContent sx={{ pb: 1 }}>
                    <Typography fontWeight={700}>{load.title || "Untitled Load"}</Typography>
                    <Typography variant="body2" sx={{ my: 0.5 }}>
                      {load.origin} → {load.destination}
                    </Typography>
                    <Typography variant="body2">Rate: ${load.rate}</Typography>
                    <Typography variant="caption" sx={{ color: "#aad" }}>
                      Type: {load.equipmentType || "N/A"}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ p: 1, justifyContent: "space-between" }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setSelectedLoad(load)}
                      sx={{ color: "#fff", borderColor: "#fff" }}
                    >
                      View
                    </Button>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => handleAssign(load._id)}
                      disabled={assigning}
                    >
                      Assign
                    </Button>
                  </CardActions>
                  {selectedLoad?._id === load._id && (
                    <Box sx={{ p: 1, bgcolor: "#19202b", color: "#fff", fontSize: 14 }}>
                      <div>Commodity: {load.commodityType || "N/A"}</div>
                      <div>Special: {load.specialInstructions || "None"}</div>
                      <div>
                        Window:{" "}
                        {load.pickupTimeWindow?.start
                          ? new Date(load.pickupTimeWindow.start).toLocaleString()
                          : "—"}{" "}
                        →{" "}
                        {load.deliveryTimeWindow?.end
                          ? new Date(load.deliveryTimeWindow.end).toLocaleString()
                          : "—"}
                      </div>
                    </Box>
                  )}
                </Card>
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAssignModal}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Assigned Load Details Modal */}
      <Dialog open={viewLoadModal.open} onClose={() => setViewLoadModal({ open: false, load: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Assigned Load Details</DialogTitle>
        <DialogContent>
          {viewLoadModal.load ? (
            <>
              <Typography fontWeight={700} sx={{ mb: 1 }}>{viewLoadModal.load.title || "Untitled Load"}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Route: <b>{viewLoadModal.load.origin} → {viewLoadModal.load.destination}</b>
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Equipment Type: <b>{viewLoadModal.load.equipmentType || "N/A"}</b>
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Rate: <b>${viewLoadModal.load.rate}</b>
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Commodity: <b>{viewLoadModal.load.commodityType || "N/A"}</b>
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Special Instructions: <b>{viewLoadModal.load.specialInstructions || "None"}</b>
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Pickup Window: <b>
                  {viewLoadModal.load.pickupTimeWindow?.start
                    ? new Date(viewLoadModal.load.pickupTimeWindow.start).toLocaleString()
                    : "—"}{" "}
                  →{" "}
                  {viewLoadModal.load.deliveryTimeWindow?.end
                    ? new Date(viewLoadModal.load.deliveryTimeWindow.end).toLocaleString()
                    : "—"}
                </b>
              </Typography>
            </>
          ) : (
            <Typography>No load data.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewLoadModal({ open: false, load: null })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
