import React from "react";
import { Chip } from "@mui/material";
import { statusColor, tint } from "../../../../theme/tokens";

export default function StatusChip({ status }) {
  const color = statusColor(status);
  return (
    <Chip
      label={status}
      size="small"
      sx={{
        bgcolor: tint(color, 0.15),
        color,
        fontWeight: 700,
        fontSize: 13,
        borderRadius: 2,
        px: 2,
        letterSpacing: 0.5,
        textTransform: "capitalize",
      }}
    />
  );
}
