import React, { useState, useMemo } from "react";
import { Box, Typography, Select, MenuItem, FormControl, InputLabel, Pagination, Stack, Button, Chip } from "@mui/material";
import LoadGrid from "./components/LoadGrid";
import { useShipperLoads } from "../hooks/useShipperLoads";

// --- Helpers ---
// Normalize status: "In-transit", "IN TRANSIT", "in_transit", " in transit  " => "in transit"
const normalizeStatus = s =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

// Pretty label: "in transit" => "In Transit"
const prettyStatus = s =>
  normalizeStatus(s)
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// Status order for sorting; can expand with new statuses if needed
const statusOrder = {
  open: 1,
  accepted: 2,
  "in transit": 3,
  delivered: 99 // Always last
};

const statusColors = {
  open: "#22d3ee",
  accepted: "#a78bfa",
  "in transit": "#fbbf24",
  delivered: "#34d399",
  // fallback: "#cbd5e1"
};

const LOADS_PER_PAGE = 6;

export default function ShipperLoadBoardSection() {
  const { loads = [], isLoading, error } = useShipperLoads();

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");
  const [selectedLoad, setSelectedLoad] = useState(null);

  // Build a Set of unique, normalized statuses for dropdown and display
  const allStatuses = useMemo(() => {
    const seen = new Set();
    loads.forEach(l => {
      if (l.status) seen.add(normalizeStatus(l.status));
    });
    // Known preferred order, followed by any unknowns
    const known = ["open", "accepted", "in transit", "delivered"];
    const dynamic = Array.from(seen).filter(s => !known.includes(s));
    return [...known.filter(s => seen.has(s)), ...dynamic];
  }, [loads]);

  // Filtering, sorting, pagination
  const processedLoads = useMemo(() => {
    let arr = [...loads];
    // Filter
    if (filterStatus !== "all") {
      arr = arr.filter(
        l => normalizeStatus(l.status) === normalizeStatus(filterStatus)
      );
    }
    // Sort by status, then date
    arr.sort((a, b) => {
      const sA = statusOrder[normalizeStatus(a.status)] ?? 98;
      const sB = statusOrder[normalizeStatus(b.status)] ?? 98;
      if (sA !== sB) return sA - sB;
      const da = new Date(a.createdAt || a.pickupDate || a.pickup_time || a.pickupStart || 0);
      const db = new Date(b.createdAt || b.pickupDate || b.pickup_time || b.pickupStart || 0);
      return sortOrder === "recent" ? db - da : da - db;
    });
    return arr;
  }, [loads, filterStatus, sortOrder]);

  const pageCount = Math.ceil(processedLoads.length / LOADS_PER_PAGE);
  const pagedLoads = processedLoads.slice((page - 1) * LOADS_PER_PAGE, page * LOADS_PER_PAGE);

  React.useEffect(() => { setPage(1); }, [filterStatus, sortOrder]);

  return (
    <Box sx={{ width: "100%" }}>
      {/* Filters + Sort */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight={800} sx={{ color: "#fff", mr: "auto" }}>
          Loads
        </Typography>
        <FormControl variant="outlined" size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            sx={{ bgcolor: "rgba(255,255,255,0.07)", borderRadius: 2, color: "#fff" }}
          >
            <MenuItem value="all">All Statuses</MenuItem>
            {allStatuses.map(status =>
              <MenuItem key={status} value={status}>
                <Chip
                  label={prettyStatus(status)}
                  size="small"
                  sx={{
                    bgcolor: statusColors[status] || "#cbd5e1",
                    color: status === "open" ? "#0f172a" : "#18181b",
                    fontWeight: 700,
                    mr: 1
                  }}
                />
                {prettyStatus(status)}
              </MenuItem>
            )}
          </Select>
        </FormControl>
        <FormControl variant="outlined" size="small" sx={{ minWidth: 170 }}>
          <InputLabel>Sort By</InputLabel>
          <Select
            label="Sort By"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
            sx={{ bgcolor: "rgba(255,255,255,0.07)", borderRadius: 2, color: "#fff" }}
          >
            <MenuItem value="recent">Most Recent</MenuItem>
            <MenuItem value="oldest">Oldest</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {/* Main Content */}
      <LoadGrid
        loads={pagedLoads}
        loading={isLoading}
        errorMsg={error}
        onSelect={setSelectedLoad}
      />

      {/* Pagination */}
      {pageCount > 1 && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <Pagination
            count={pageCount}
            page={page}
            onChange={(_, v) => setPage(v)}
            color="primary"
            sx={{
              "& .MuiPaginationItem-root": {
                color: "#fff",
                bgcolor: "rgba(255,255,255,0.08)",
                borderRadius: 2,
                "&.Mui-selected": {
                  bgcolor: "#6a1fcf",
                  color: "#fff"
                }
              }
            }}
          />
        </Box>
      )}

      {/* Details Modal */}
      {selectedLoad && (
        <Box
          sx={{
            position: "fixed",
            top: 0, left: 0, width: "100vw", height: "100vh",
            zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center",
            bgcolor: "rgba(34,25,84,0.75)",
            backdropFilter: "blur(2px)",
          }}
          onClick={() => setSelectedLoad(null)}
        >
          <Box
            onClick={e => e.stopPropagation()}
            sx={{
              bgcolor: "rgba(36,24,72,0.97)",
              borderRadius: 4,
              p: { xs: 3, md: 5 },
              boxShadow: "0 8px 44px 0 #6a1fcf77",
              color: "#fff",
              minWidth: 350,
              maxWidth: "96vw",
              borderLeft: "5px solid #6a1fcf"
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                Load Details
              </Typography>
              <Button
                onClick={() => setSelectedLoad(null)}
                variant="text"
                sx={{ minWidth: 0, color: "#fff" }}
              >
                Close
              </Button>
            </Box>
            <Typography mb={1}><b>Route:</b> {selectedLoad.origin} → {selectedLoad.destination}</Typography>
            <Typography mb={1}><b>Title:</b> {selectedLoad.title}</Typography>
            <Typography mb={1}><b>Equipment:</b> {selectedLoad.equipmentType}</Typography>
            <Typography mb={1}><b>Rate:</b> <span style={{ color: "#6a1fcf", fontWeight: 700 }}>${selectedLoad.rate}</span></Typography>
            <Typography mb={1}><b>Status:</b> {prettyStatus(selectedLoad.status)}</Typography>
            <Typography mb={1}><b>Notes:</b> {selectedLoad.notes || "-"}</Typography>
            {/* Add more fields as needed */}
          </Box>
        </Box>
      )}
    </Box>
  );
}
