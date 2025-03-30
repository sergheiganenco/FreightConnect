// src/pages/CarrierDashboard.js
import React, { useState, useEffect } from "react";
import {
  Typography, Box, CircularProgress, Snackbar, Alert,
  FormControl, InputLabel, Select, MenuItem, TextField, Button, Grid, Paper, Tabs, Tab
} from "@mui/material";
import api from "../services/api";
import LoadCard from "../components/LoadCard";
import LoadDetailsModal from "../components/LoadDetailsModal";
import CarrierLocationTracker from "../components/CarrierLocationTracker";
import RecommendedLoads from "../components/RecommendedLoads";
import LogisticsAssistant from "../components/LogisticsAssistant";
import DocumentsPage from "./DocumentsPage"; // Ensure DocumentsPage component exists

function CarrierDashboard() {
  const [userRole] = useState("carrier");
  const [loads, setLoads] = useState([]);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [activeLoadId, setActiveLoadId] = useState(null);
  const [currentTab, setCurrentTab] = useState(0);

  const [filters, setFilters] = useState({
    status: "open",
    equipmentType: "",
    minRate: "",
    maxRate: "",
    pickupStart: "",
    pickupEnd: "",
    sortBy: "pickupTimeWindow.start",
    sortOrder: "asc",
  });

  useEffect(() => {
    const fetchLoads = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("token");
        const response = await api.get("/loads", {
          headers: { Authorization: `Bearer ${token}` },
          params: filters,
        });
        setLoads(response.data);
      } catch (err) {
        setError("Failed to fetch loads. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchLoads();
  }, [filters]);

  useEffect(() => {
    const findActiveLoad = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await api.get("/loads/my-loads", {
          headers: { Authorization: `Bearer ${token}` },
        });

        const activeLoad = response.data.find(load =>
          load.status === 'accepted' || load.status === 'in-transit'
        );

        setActiveLoadId(activeLoad ? activeLoad._id : null);
      } catch (err) {
        console.error("Error fetching active load:", err);
      }
    };

    findActiveLoad();
  }, [loads]);

  const handleLoadAccepted = (loadId) => {
    setLoads((prevLoads) => prevLoads.filter((load) => load._id !== loadId));
    setSnackbarMessage('Load accepted successfully!');
    setSnackbarOpen(true);
  };

  const handleFilterChange = (e) => {
    setFilters((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSnackbarClose = () => {
    setSnackbarOpen(false);
  };

  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: "0 auto", p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Carrier Dashboard
      </Typography>

      <Tabs value={currentTab} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab label="Loads" />
        <Tab label="Documents" />
      </Tabs>

      {currentTab === 0 && (
        <>
          {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

          <Paper sx={{ p: 2, mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    name="status"
                    value={filters.status}
                    onChange={handleFilterChange}
                    label="Status"
                  >
                    <MenuItem value="open">Open</MenuItem>
                    <MenuItem value="accepted">Accepted</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" name="equipmentType" label="Equipment Type" value={filters.equipmentType} onChange={handleFilterChange} />
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField fullWidth size="small" type="number" name="minRate" label="Min Rate" value={filters.minRate} onChange={handleFilterChange} />
              </Grid>
              <Grid item xs={12} sm={2}>
                <TextField fullWidth size="small" type="number" name="maxRate" label="Max Rate" value={filters.maxRate} onChange={handleFilterChange} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} name="pickupStart" label="Pickup Start Date" value={filters.pickupStart} onChange={handleFilterChange} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} name="pickupEnd" label="Pickup End Date" value={filters.pickupEnd} onChange={handleFilterChange} />
              </Grid>
              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Sort By</InputLabel>
                  <Select name="sortBy" value={filters.sortBy} onChange={handleFilterChange} label="Sort By">
                    <MenuItem value="pickupTimeWindow.start">Pickup Date</MenuItem>
                    <MenuItem value="rate">Rate</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>Order</InputLabel>
                  <Select name="sortOrder" value={filters.sortOrder} onChange={handleFilterChange} label="Order">
                    <MenuItem value="asc">Ascending</MenuItem>
                    <MenuItem value="desc">Descending</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
            <Button variant="contained" sx={{ mt: 2 }} onClick={() => setFilters({ ...filters })}>Apply Filters</Button>
          </Paper>

          {loading ? (
            <Box display="flex" justifyContent="center"><CircularProgress /></Box>
          ) : loads.length ? (
            loads.map(load => (
              <LoadCard key={load._id} load={load} onViewDetails={() => setSelectedLoad(load)} />
            ))
          ) : (
            <Typography>No loads found.</Typography>
          )}

          {selectedLoad && (
            <LoadDetailsModal load={selectedLoad} userRole={userRole} onClose={() => setSelectedLoad(null)} onLoadAccepted={handleLoadAccepted} />
          )}

          {activeLoadId && (
            <>
              <CarrierLocationTracker loadId={activeLoadId} />
              <RecommendedLoads loadId={activeLoadId} onLoadAccepted={handleLoadAccepted} />
            </>
          )}

          <LogisticsAssistant />
        </>
      )}

      {currentTab === 1 && (
        <DocumentsPage />  
      )}

      <Snackbar open={snackbarOpen} autoHideDuration={3000} onClose={handleSnackbarClose}>
        <Alert severity="success">{snackbarMessage}</Alert>
      </Snackbar>
    </Box>
  );
}

export default CarrierDashboard;
