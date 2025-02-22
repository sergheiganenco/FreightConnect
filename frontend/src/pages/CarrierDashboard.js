// src/pages/CarrierDashboard.js

import React, { useState, useEffect } from "react";
import { Typography, Box } from "@mui/material";
import api from "../services/api";
import LoadCard from "../components/LoadCard";
import LoadDetailsModal from "../components/LoadDetailsModal";

function CarrierDashboard() {
  // We set the user role to "carrier" so we can display the "Accept Load" button.
  const [userRole] = useState("carrier");

  const [loads, setLoads] = useState([]);
  const [selectedLoad, setSelectedLoad] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchLoads = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) throw new Error("No token found");

        const response = await api.get("/loads", {
          headers: { Authorization: `Bearer ${token}` },
        });

        // For carriers: Show only open loads (or include accepted if needed)
        setLoads(response.data.filter((l) => l.status === "open"));
      } catch (err) {
        console.error("Error fetching loads:", err.response?.data || err.message);
        setError("Failed to fetch loads.");
      }
    };

    fetchLoads();
  }, []);

  // Remove the accepted load from our local state once accepted
  const handleLoadAccepted = (loadId) => {
    setLoads((prevLoads) => prevLoads.filter((load) => load._id !== loadId));

    // If the same load is in the modal, update its status or close the modal
    if (selectedLoad?._id === loadId) {
      setSelectedLoad({ ...selectedLoad, status: "accepted" });
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: "0 auto", p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Carrier Dashboard
      </Typography>

      {error && <Typography color="error">{error}</Typography>}

      {loads.length > 0 ? (
        loads.map((load) => (
          <LoadCard
            key={load._id}
            load={load}
            onViewDetails={() => setSelectedLoad(load)}
          />
        ))
      ) : (
        <Typography>No available loads.</Typography>
      )}

      {/* Load Details Modal */}
      {selectedLoad && (
        <LoadDetailsModal
          load={selectedLoad}
          userRole={userRole}                // <-- Pass "carrier" to show Accept Load
          onClose={() => setSelectedLoad(null)}
          onLoadAccepted={handleLoadAccepted}
        />
      )}
    </Box>
  );
}

export default CarrierDashboard;
