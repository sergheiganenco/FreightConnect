import React, { useRef, useState } from "react";
import { Box, Typography, Chip, Button, CircularProgress, Stack } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import { brand, semantic, status as ST, surface, text as T } from '../../theme/tokens';

const STATUS_COLOR = { Uploaded: brand.indigoLight, Signed: semantic.success, Missing: ST.accepted, Expired: ST.disputed };
const BUTTON_BG = { Uploaded: brand.indigo, Signed: semantic.success, Missing: brand.indigoLight, Expired: ST.disputed };

/**
 * Props:
 * doc:      { label, url }  (label = "BOL", "Invoice", "POD", etc)
 * status:   "Uploaded" | "Signed" | "Missing" | "Expired"
 * loading:  boolean
 * onClick:  function for view/download (or generate if allowed)
 * onUpload: function for drag/drop/click-to-upload (optional)
 * route:    "City → City"
 * isUpload: boolean (only for upload doc rows)
 * showPreview: boolean (for inline PDF preview)
 * fileType: "pdf" | etc (for future)
 * canGenerate: boolean (show Generate button for missing docs)
 */
export default function DocumentRow({
  doc,
  status,
  loading,
  onClick,
  onUpload,
  route,
  isUpload = false,
  showPreview = false,
  fileType = "pdf",
  canGenerate = false,
}) {
  const inputRef = useRef();
  const [dragActive, setDragActive] = useState(false);

  // Handle drag-and-drop for upload (if you use this for carrier uploads)
  const handleDrop = e => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onUpload({ target: { files: [e.dataTransfer.files[0]] } });
    }
  };

  return (
    <Box
      display="flex"
      flexDirection={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "stretch", sm: "center" }}
      justifyContent="space-between"
      gap={1.8}
      sx={{
        mb: 0.5, p: 0, minWidth: 0,
        border: dragActive ? `2px dashed ${brand.indigoLight}` : "none",
        background: dragActive ? surface.indigoTint : "none"
      }}
      onDragOver={isUpload ? e => { e.preventDefault(); setDragActive(true); } : undefined}
      onDragLeave={isUpload ? () => setDragActive(false) : undefined}
      onDrop={isUpload ? handleDrop : undefined}
    >
      <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
        <DescriptionIcon sx={{ fontSize: 36, color: T.primary, flexShrink: 0 }} />
        <Box>
          <Typography fontWeight={800} color={T.primary} fontSize="1.13em">
            {doc.label}.pdf
          </Typography>
          <Typography fontSize="0.97em" color={T.navInactive}>
            {route}
          </Typography>
        </Box>
      </Box>
      <Stack direction="row" alignItems="center" spacing={1.5} mt={{ xs: 1, sm: 0 }}>
        <Chip
          label={status}
          sx={{
            bgcolor: STATUS_COLOR[status] || "#ccc",
            color: T.primary,
            fontWeight: 700,
            fontSize: "1.07em",
            px: 2,
            height: 34,
            boxShadow: "0 1px 6px #4f46e510"
          }}
        />
        {/* ---- ACTION BUTTONS ---- */}
        {/* Upload for carriers (not for shippers, so usually isUpload is false for shipper) */}
        {isUpload ? (
          <Button
            component="label"
            variant="contained"
            disabled={loading}
            sx={{
              borderRadius: 99,
              fontWeight: 800,
              minWidth: 108,
              background: BUTTON_BG[status],
              color: T.primary,
              fontSize: "1.01em",
              boxShadow: "0 2px 8px #6366F160",
              px: 2,
              transition: "background 0.2s, box-shadow 0.2s",
              "&:hover": {
                background: BUTTON_BG[status] === "#34D399"
                  ? "#059669"
                  : BUTTON_BG[status] === "#F87171"
                  ? "#dc2626"
                  : "#4338ca",
                boxShadow: "0 6px 18px #6366F130"
              }
            }}
          >
            {loading ? <CircularProgress size={16} /> : (doc.url ? "Replace" : "Upload")}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onUpload}
            />
          </Button>
        ) : doc.url ? (
          // Show only "View" or "Download" if doc exists
          <Button
            variant="contained"
            onClick={onClick}
            disabled={loading}
            sx={{
              borderRadius: 99,
              fontWeight: 800,
              minWidth: 108,
              background: BUTTON_BG[status],
              color: T.primary,
              fontSize: "1.01em",
              boxShadow: "0 2px 8px #6366F160",
              px: 2,
              transition: "background 0.2s, box-shadow 0.2s",
              "&:hover": {
                background: BUTTON_BG[status] === "#34D399"
                  ? "#059669"
                  : BUTTON_BG[status] === "#F87171"
                  ? "#dc2626"
                  : "#4338ca",
                boxShadow: "0 6px 18px #6366F130"
              }
            }}
          >
            {loading
              ? <CircularProgress size={16} />
              : (doc.label === "Invoice" ? "Download" : "View")}
          </Button>
        ) : canGenerate ? (
          // For carriers/admins: show "Generate" if allowed, but NOT for shippers!
          <Button
            variant="contained"
            onClick={onClick}
            disabled={loading}
            sx={{
              borderRadius: 99,
              fontWeight: 800,
              minWidth: 108,
              background: BUTTON_BG[status],
              color: T.primary,
              fontSize: "1.01em",
              boxShadow: "0 2px 8px #6366F160",
              px: 2,
              transition: "background 0.2s, box-shadow 0.2s",
              "&:hover": {
                background: "#4338ca",
                boxShadow: "0 6px 18px #6366F130"
              }
            }}
          >
            {loading ? <CircularProgress size={16} /> : "Generate"}
          </Button>
        ) : null}
      </Stack>
      {/* Inline PDF preview, optional */}
      {showPreview && doc.url && fileType === "pdf" && (
        <Box sx={{ mt: 2, borderRadius: 4, overflow: "hidden", bgcolor: T.primary }}>
          <embed
            src={doc.url}
            width="100%"
            height="250px"
            type="application/pdf"
            style={{ borderRadius: 8, background: "#fff" }}
          />
        </Box>
      )}
    </Box>
  );
}
