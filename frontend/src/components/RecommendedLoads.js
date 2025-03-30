import React, { useState, useEffect } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import api from "../services/api";
import LoadCard from "../components/LoadCard";
import LoadDetailsModal from "../components/LoadDetailsModal";

function RecommendedLoads({ loadId, onLoadAccepted }) {
  const [recommendedLoads, setRecommendedLoads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedLoad, setSelectedLoad] = useState(null); // New state for selected load

  useEffect(() => {
    const fetchRecommendedLoads = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("token");
        const response = await api.get(`/loads/recommended/${loadId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setRecommendedLoads(response.data);
      } catch (err) {
        setError("Failed to fetch recommended loads. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    if (loadId) {
      fetchRecommendedLoads();
    }
  }, [loadId]);

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5" gutterBottom>
        Recommended Loads
      </Typography>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center">
          <CircularProgress />
        </Box>
      ) : recommendedLoads.length ? (
        recommendedLoads.map(load => (
          <LoadCard 
            key={load._id} 
            load={load} 
            onViewDetails={() => setSelectedLoad(load)} // Now sets selected load
          />
        ))
      ) : (
        <Typography>No recommended loads found.</Typography>
      )}

      {/* This ensures details pop up correctly */}
      {selectedLoad && (
        <LoadDetailsModal
          load={selectedLoad}
          userRole="carrier"
          onClose={() => setSelectedLoad(null)}
          onLoadAccepted={onLoadAccepted}
        />
      )}
    </Box>
  );
}

export default RecommendedLoads;
