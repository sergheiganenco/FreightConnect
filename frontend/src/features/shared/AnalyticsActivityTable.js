// src/features/shared/AnalyticsActivityTable.jsx
import React from "react";
import {
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, Paper, Chip
} from "@mui/material";
import BRAND from "../../config/branding";

const statusColor = {
  Delivered: "success",
  "In Transit": "warning",
  Open: "info",
  Refused: "error"
};

export default function AnalyticsActivityTable({ rows = [], type = "shipper" }) {
  return (
    <TableContainer
      component={Paper}
      sx={{
        mt: 4,
        bgcolor: BRAND.glass,
        borderRadius: 4,
        boxShadow: 4,
        minWidth: 300,
      }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Load #</TableCell>
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Route</TableCell>
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Status</TableCell>
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Amount</TableCell>
            {type === "shipper" && (
              <TableCell sx={{ color: "#fff", fontWeight: 700 }}>POD</TableCell>
            )}
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Date</TableCell>
            <TableCell sx={{ color: "#fff", fontWeight: 700 }}>Details</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.loadId || row.id}>
              <TableCell sx={{ color: "#fff" }}>{row.loadId || row.id}</TableCell>
              <TableCell sx={{ color: "#fff" }}>{row.route}</TableCell>
              <TableCell>
                <Chip
                  label={row.status}
                  color={statusColor[row.status] || "default"}
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              </TableCell>
              <TableCell sx={{ color: "#fff" }}>{row.amount}</TableCell>
              {type === "shipper" && (
                <TableCell>
                  {row.podStatus === "complete" ? (
                    <Chip label="Complete" color="success" size="small" />
                  ) : (
                    <Chip label="Missing" color="warning" size="small" />
                  )}
                </TableCell>
              )}
              <TableCell sx={{ color: "#fff" }}>
                {new Date(row.date).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <a
                  href={`/dashboard/${type}/loads/${row.loadId || row.id}`}
                  style={{
                    color: BRAND.primaryColor,
                    fontWeight: 600,
                    textDecoration: "none"
                  }}
                >
                  View
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
