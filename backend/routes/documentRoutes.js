const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const multer = require('multer');
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');

const router = express.Router();

const uploadsDir = path.join(__dirname, '../public/documents/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir });

// ------------------------------
// Generate BOL PDF
router.post('/generate-bol', auth, async (req, res) => {
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
      // Only respond after the file is fully written!
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
// Upload POD (Proof of Delivery)
// ------------------------------
router.post('/upload-pod/:loadId', auth, upload.single('file'), async (req, res) => {
  try {
    const { loadId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Rename/move to standard name
    const newFileName = `${loadId}-pod.pdf`;
    const destPath = path.join(uploadsDir, newFileName);
    fs.renameSync(req.file.path, destPath);

    // Optionally update Load with POD uploaded info

    res.json({ filePath: `/documents/uploads/${newFileName}` });
  } catch (err) {
    console.error('POD upload error:', err);
    res.status(500).json({ error: 'Failed to upload POD' });
  }
});

// ------------------------------
// Generic Document Upload (optional)
// ------------------------------
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filePath: `/documents/uploads/${req.file.filename}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// ------------------------------
// Secure File Access (with path traversal protection)
router.get('/test-pdf/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});


router.post('/generate-invoice', auth, async (req, res) => {
  const { loadId } = req.body;
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



module.exports = router;
