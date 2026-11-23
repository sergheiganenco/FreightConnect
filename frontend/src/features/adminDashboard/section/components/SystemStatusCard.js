import React, { useEffect, useState } from "react";
import { Alert, Chip, Stack, Tooltip, Typography } from "@mui/material";
import api from "../../../../services/api";

/** Which connections the platform depends on are switched on, and whether uploaded files are safe. */
export default function SystemStatusCard() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.get("/admin/system-status").then((r) => setStatus(r.data)).catch(() => setStatus(false));
  }, []);

  if (status === null) return null;
  if (status === false) return <Alert severity="warning" sx={{ mb: 2 }}>System status could not be loaded.</Alert>;

  const { storage } = status;
  const items = [
    { label: "Database", on: status.database, note: "The database is not connected." },
    {
      label: "Document storage",
      on: storage.writable && storage.survivesRestart !== false,
      note: storage.writable ? null : "Uploaded documents cannot be saved.",
      pending: storage.writable && storage.survivesRestart === null && "Confirmed after the next restart",
    },
    ...status.connections,
  ];

  return (
    <Alert severity={status.ok ? "success" : "error"} sx={{ mb: 3 }}>
      <Typography fontWeight={700} mb={status.problems.length ? 0.5 : 1}>
        {status.ok ? "All required systems are on" : "Needs attention"}
      </Typography>
      {status.problems.map((p) => (
        <Typography key={p} variant="body2">{p}</Typography>
      ))}
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} mt={1}>
        {items.map((i) => (
          <Tooltip key={i.label} title={i.note || i.pending || ""}>
            <Chip
              size="small"
              label={`${i.label}: ${i.on ? (i.pending ? "on (unconfirmed)" : "on") : "off"}`}
              color={i.on ? "success" : i.critical === false ? "default" : "error"}
              variant={i.on ? "filled" : "outlined"}
            />
          </Tooltip>
        ))}
      </Stack>
    </Alert>
  );
}
