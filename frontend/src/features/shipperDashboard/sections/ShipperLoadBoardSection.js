import React, { useState, useMemo } from "react";
import { Box, Typography, Select, MenuItem, FormControl, InputLabel, Pagination, Stack, Chip } from "@mui/material";
import LoadGrid from "./components/LoadGrid";
import { useShipperLoads } from "../hooks/useShipperLoads";
import LoadDetailsModal from "../../../components/LoadDetailsModal";
import { status as ST, surface, text as T, brand, statusColor } from "../../../theme/tokens";

// --- Helpers ---
const normalizeStatus = s =>
  (s || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

const prettyStatus = s =>
  normalizeStatus(s).split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const statusOrder = {
  open: 1,
  accepted: 2,
  "in transit": 3,
  delivered: 99
};

const LOADS_PER_PAGE = 6;

export default function ShipperLoadBoardSection() {
  const { loads = [], isLoading, error } = useShipperLoads();

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");
  const [selectedLoad, setSelectedLoad] = useState(null);

  const allStatuses = useMemo(() => {
    const seen = new Set();
    loads.forEach(l => { if (l.status) seen.add(normalizeStatus(l.status)); });
    const known = ["open", "accepted", "in transit", "delivered"];
    const dynamic = Array.from(seen).filter(s => !known.includes(s));
    return [...known.filter(s => seen.has(s)), ...dynamic];
  }, [loads]);

  const processedLoads = useMemo(() => {
    let arr = [...loads];
    if (filterStatus !== "all") {
      arr = arr.filter(l => normalizeStatus(l.status) === normalizeStatus(filterStatus));
    }
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
        <Typography variant="h4" fontWeight={800} sx={{ color: T.primary, mr: "auto" }}>
          Loads
        </Typography>
        <FormControl variant="outlined" size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            sx={{ bgcolor: surface.glassHover, borderRadius: 2, color: T.primary }}
          >
            <MenuItem value="all">All Statuses</MenuItem>
            {allStatuses.map(s =>
              <MenuItem key={s} value={s}>
                <Chip
                  label={prettyStatus(s)}
                  size="small"
                  sx={{
                    bgcolor: statusColor(s),
                    color: s === "open" ? T.dark : T.darkAlt,
                    fontWeight: 700,
                    mr: 1
                  }}
                />
                {prettyStatus(s)}
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
            sx={{ bgcolor: surface.glassHover, borderRadius: 2, color: T.primary }}
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
                color: T.primary,
                bgcolor: surface.glassHover,
                borderRadius: 2,
                "&.Mui-selected": {
                  bgcolor: brand.primary,
                  color: T.primary
                }
              }
            }}
          />
        </Box>
      )}

      {/* Details Modal */}
      {selectedLoad && (
        <LoadDetailsModal
          load={selectedLoad}
          userRole="shipper"
          onClose={() => setSelectedLoad(null)}
        />
      )}
    </Box>
  );
}
