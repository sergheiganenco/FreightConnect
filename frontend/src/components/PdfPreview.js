import React from "react";
import { Dialog, DialogContent, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { Document, Page, pdfjs } from "react-pdf";

// point to worker in public/
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

const PDFPreview = ({ open, url, onClose }) => (
  <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
    <IconButton
      onClick={onClose}
      sx={{ position: "absolute", right: 8, top: 8, color: "#722ED1", zIndex: 1 }}
    >
      <CloseIcon />
    </IconButton>
    <DialogContent sx={{ bgcolor: "#F6F3FA" }}>
      {url ? (
        <Document file={url} onLoadError={() => <p>Cannot load PDF.</p>}>
          <Page pageNumber={1} />
        </Document>
      ) : (
        <p>No PDF specified.</p>
      )}
    </DialogContent>
  </Dialog>
);

export default PDFPreview;
