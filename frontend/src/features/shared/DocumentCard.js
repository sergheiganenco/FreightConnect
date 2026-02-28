// src/features/shared/DocumentCard.jsx
import React from "react";
import { Paper, Typography, Box, Chip, IconButton, Tooltip } from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import HistoryIcon from "@mui/icons-material/History";
import DownloadIcon from "@mui/icons-material/Download";
import RemoveRedEyeIcon from "@mui/icons-material/RemoveRedEye";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteIcon from "@mui/icons-material/Delete";
import BRAND from "../../config/branding";

const STATUS_COLOR = {
  uploaded: "info",
  signed: "success",
  missing: "default",
  expired: "error",
  refused: "error",
};

const DOC_ICONS = {
  pdf: <PictureAsPdfIcon sx={{ color: "#ec4899" }} />,
  jpg: <ImageIcon sx={{ color: "#9333ea" }} />,
  png: <ImageIcon sx={{ color: "#9333ea" }} />,
  jpeg: <ImageIcon sx={{ color: "#9333ea" }} />,
};

export default function DocumentCard({
  doc,
  onView,
  onDownload,
  onUpload,
  onReplace,
  onDelete,
  onHistory,
  role = "shipper",
}) {
  const fileType = (doc.fileName || "").split(".").pop().toLowerCase();
  const icon = DOC_ICONS[fileType] || <InsertDriveFileIcon sx={{ color: "#6a1fcf" }} />;

  return (
    <Paper
      sx={{
        p: 2,
        mb: 2,
        borderRadius: 3,
        background: BRAND.glass,
        backdropFilter: "blur(16px)",
        display: "flex",
        alignItems: "center",
        gap: 2,
        minWidth: 320,
      }}
      elevation={4}
    >
      <Box>{icon}</Box>
      <Box flex={1}>
        <Typography fontWeight={600}>{doc.fileName || doc.docType}</Typography>
        <Typography variant="body2" color="#ccc">
          {doc.route || doc.loadRoute || doc.loadId || "-"}
        </Typography>
        <Chip
          size="small"
          label={doc.status || "missing"}
          color={STATUS_COLOR[doc.status] || "default"}
          sx={{ mt: 0.5, fontWeight: 600 }}
        />
        <Typography variant="caption" color="#999">
          {doc.uploadedBy ? `by ${doc.uploadedBy}` : ""}
          {doc.uploadedAt ? ` | ${new Date(doc.uploadedAt).toLocaleString()}` : ""}
        </Typography>
      </Box>
      <Box display="flex" gap={1}>
        {doc.status === "uploaded" && (
          <Tooltip title="View/Preview">
            <IconButton onClick={onView}><RemoveRedEyeIcon /></IconButton>
          </Tooltip>
        )}
        {doc.status === "missing" && !!onUpload && (
          <Tooltip title="Upload">
            <IconButton color="primary" onClick={onUpload}><CloudUploadIcon /></IconButton>
          </Tooltip>
        )}
        {doc.status === "uploaded" && (
          <Tooltip title="Download">
            <IconButton onClick={onDownload}><DownloadIcon /></IconButton>
          </Tooltip>
        )}
        {!!onHistory && (
          <Tooltip title="Version History">
            <IconButton onClick={onHistory}><HistoryIcon /></IconButton>
          </Tooltip>
        )}
        {(role === "admin" || role === "shipper") && !!onDelete && (
          <Tooltip title="Delete">
            <IconButton color="error" onClick={onDelete}><DeleteIcon /></IconButton>
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
}
