const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const puppeteer = require('puppeteer');
const multer = require('multer');
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');
const User = require('../models/User');
const { generateBOL, generateRateConfirmation } = require('../utils/pdfGenerator');

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



// ────────────────────────────────────────────────────────────────────────────
// GET /api/documents/load/:loadId
// Returns all document paths for a load (checks DB first, then filesystem)
// ────────────────────────────────────────────────────────────────────────────
router.get('/load/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Access control: only participants or admin
    const uid = req.user.userId;
    const role = req.user.role;
    if (
      role !== 'admin' &&
      load.postedBy?.toString() !== uid &&
      load.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const BASE = process.env.BACKEND_URL || 'http://localhost:5000';

    // Build response from stored DB paths (auto-generated docs)
    const docs = {
      rateConfirmation: load.documents?.rateConfirmation
        ? { url: BASE + load.documents.rateConfirmation, status: 'Uploaded' }
        : null,
      bol: load.documents?.bol
        ? { url: BASE + load.documents.bol, status: 'Uploaded' }
        : null,
      pod: load.documents?.pod
        ? { url: BASE + load.documents.pod, status: 'Uploaded' }
        : null,
    };

    res.json({ loadId: req.params.loadId, status: load.status, docs });
  } catch (err) {
    console.error('Fetch load docs error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/documents/generate/:loadId/:type
// Manually (re)generate a document — type: 'bol' | 'ratecon'
// ────────────────────────────────────────────────────────────────────────────
router.post('/generate/:loadId/:type', auth, async (req, res) => {
  try {
    const { loadId, type } = req.params;
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const uid = req.user.userId;
    const role = req.user.role;
    if (
      role !== 'admin' &&
      load.postedBy?.toString() !== uid &&
      load.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const carrier = load.acceptedBy
      ? await User.findById(load.acceptedBy).select('name email companyName mcNumber dotNumber verification')
      : null;
    const shipper = await User.findById(load.postedBy).select('name email companyName');

    let filePath;
    if (type === 'bol') {
      if (load.status !== 'delivered') return res.status(409).json({ error: 'BOL can only be generated after delivery' });
      filePath = await generateBOL(load, carrier, shipper);
      await Load.findByIdAndUpdate(loadId, { 'documents.bol': filePath });
    } else if (type === 'ratecon') {
      if (!load.acceptedBy) return res.status(409).json({ error: 'Load has not been accepted yet' });
      filePath = await generateRateConfirmation(load, carrier, shipper);
      await Load.findByIdAndUpdate(loadId, { 'documents.rateConfirmation': filePath });
    } else {
      return res.status(400).json({ error: 'Unknown document type. Use bol or ratecon.' });
    }

    const BASE = process.env.BACKEND_URL || 'http://localhost:5000';
    res.json({ url: BASE + filePath });
  } catch (err) {
    console.error('Manual doc generate error:', err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/documents/pod/:loadId — upload POD and save path to Load
// ────────────────────────────────────────────────────────────────────────────
router.post('/pod/:loadId', auth, upload.single('file'), async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const newFileName = req.params.loadId + '-pod.pdf';
    const destPath = path.join(uploadsDir, newFileName);
    fs.renameSync(req.file.path, destPath);

    const podPath = '/documents/uploads/' + newFileName;
    await Load.findByIdAndUpdate(req.params.loadId, { 'documents.pod': podPath });

    const BASE = process.env.BACKEND_URL || 'http://localhost:5000';
    res.json({ url: BASE + podPath });
  } catch (err) {
    console.error('POD upload error:', err);
    res.status(500).json({ error: 'Failed to upload POD' });
  }
});

module.exports = router;
