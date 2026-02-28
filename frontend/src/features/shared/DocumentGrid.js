// src/features/shared/DocumentGrid.jsx
import React from "react";
import { Grid, Typography } from "@mui/material";
import DocumentCard from "./DocumentCard";

export default function DocumentGrid({
  documents,
  loading,
  errorMsg,
  ...cardProps
}) {
  if (loading) return <Typography>Loading...</Typography>;
  if (errorMsg) return <Typography color="error">{errorMsg}</Typography>;
  if (!documents.length) return <Typography>No documents found.</Typography>;

  return (
    <Grid container spacing={2}>
      {documents.map((doc) => (
        <Grid item xs={12} md={6} key={doc._id || doc.fileName}>
          <DocumentCard doc={doc} {...cardProps} />
        </Grid>
      ))}
    </Grid>
  );
}
