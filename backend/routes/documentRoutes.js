const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');

const router = express.Router();

// Ensure /uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ------------------------------
// Generate BOL PDF
// ------------------------------
router.post('/generate-pdf', auth, async (req, res) => {
  const { loadId } = req.body;

  try {
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const fileName = `${load._id}-bol.pdf`;
    const filePath = path.join(uploadsDir, fileName);

    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text('Bill of Lading', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Shipper: ${load.shipper || 'N/A'}`);
    doc.text(`Carrier: ${load.carrier || 'N/A'}`);
    doc.text(`Origin: ${load.origin}`);
    doc.text(`Destination: ${load.destination}`);
    doc.text(`Rate: $${load.rate}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();
    doc.text('Carrier Signature: ________________________');
    doc.end();

    stream.on('finish', () => {
      res.json({ filePath: `/documents/uploads/${fileName}` });
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Failed to generate BOL PDF' });
    });
  } catch (err) {
    console.error('BOL generation error:', err);
    res.status(500).json({ error: 'Failed to generate BOL PDF' });
  }
});

// ------------------------------
// Generate Invoice PDF from HTML Template
// ------------------------------
router.get('/generate-invoice/:loadId', auth, async (req, res) => {
  const { loadId } = req.params;

  try {
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const templatePath = path.join(__dirname, '../Templates/invoicetemplate.html');
    let html = fs.readFileSync(templatePath, 'utf-8');

    const invoiceData = {
      invoiceNumber: `INV-${Date.now()}`,
      date: new Date().toLocaleDateString(),
      carrierName: load.carrier || 'N/A',
      shipperName: load.shipper || 'N/A',
      description: `${load.origin} → ${load.destination}`,
      rate: load.rate || 0,
    };

    // Replace placeholders in template
    for (const [key, value] of Object.entries(invoiceData)) {
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    const invoiceFileName = `${load._id}-invoice.pdf`;
    const invoicePath = path.join(uploadsDir, invoiceFileName);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: invoicePath, format: 'A4' });
    await browser.close();

    return res.json({ filePath: `/documents/uploads/${invoiceFileName}` });
  } catch (err) {
    console.error('Invoice generation error:', err);
    return res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
});

// ------------------------------
// Secure File Access
// ------------------------------
router.get('/uploads/:filename', auth, (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filePath);
  } else {
    console.error('File not found:', filePath);
    res.status(404).json({ message: 'Document not found' });
  }
});

module.exports = router;
