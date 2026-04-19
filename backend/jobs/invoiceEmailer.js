/**
 * Invoice Emailer — Automated invoice email delivery
 *
 * Runs every hour. Finds delivered loads with issued invoices that
 * have not yet been emailed, generates a professional HTML invoice
 * email, sends it to the shipper, and marks the invoice as emailed.
 */

const cron    = require('node-cron');
const Invoice = require('../models/Invoice');
const Load    = require('../models/Load');
const User    = require('../models/User');
const { sendEmail } = require('../services/emailService');

/**
 * Generate professional HTML invoice email body
 */
function buildInvoiceHTML(invoice, load, shipper, carrier) {
  const lineItemsHTML = (invoice.lineItems || []).map(item => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${item.description || 'Freight charge'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${item.quantity || 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${(item.unitAmount || 0).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  // Fallback if no line items
  const fallbackRow = lineItemsHTML || `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">Freight: ${load.origin} → ${load.destination}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">1</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${(invoice.subtotal || 0).toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${(invoice.subtotal || 0).toFixed(2)}</td>
    </tr>
  `;

  const issuedDate = invoice.issuedAt
    ? new Date(invoice.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const dueDate = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Net 30';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Roboto,Arial,sans-serif;margin:0;padding:0;background:#f5f5f5;">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

    <!-- Header -->
    <div style="background:#1a237e;color:#fff;padding:24px 32px;">
      <h1 style="margin:0;font-size:22px;">FreightConnect</h1>
      <p style="margin:4px 0 0;font-size:13px;opacity:.85;">Invoice Notification</p>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px;">
      <p style="margin:0 0 16px;">Hi ${shipper.name || 'Customer'},</p>
      <p style="margin:0 0 24px;">Please find below the invoice details for your recent shipment.</p>

      <!-- Invoice Meta -->
      <table style="width:100%;margin-bottom:20px;font-size:14px;">
        <tr>
          <td style="padding:4px 0;"><strong>Invoice #:</strong></td>
          <td>${invoice.invoiceNumber}</td>
          <td style="padding:4px 0;"><strong>Issue Date:</strong></td>
          <td>${issuedDate}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;"><strong>Load:</strong></td>
          <td>${load.title || 'N/A'}</td>
          <td style="padding:4px 0;"><strong>Due Date:</strong></td>
          <td>${dueDate}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;"><strong>Route:</strong></td>
          <td colspan="3">${load.origin} → ${load.destination}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;"><strong>Carrier:</strong></td>
          <td colspan="3">${carrier.companyName || carrier.name || 'N/A'}</td>
        </tr>
      </table>

      <!-- Line Items -->
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="padding:10px 12px;text-align:left;">Description</th>
            <th style="padding:10px 12px;text-align:center;">Qty</th>
            <th style="padding:10px 12px;text-align:right;">Unit Price</th>
            <th style="padding:10px 12px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${fallbackRow}
        </tbody>
      </table>

      <!-- Totals -->
      <table style="width:100%;font-size:14px;margin-bottom:24px;">
        <tr>
          <td style="padding:4px 0;text-align:right;"><strong>Subtotal:</strong></td>
          <td style="padding:4px 12px;text-align:right;width:120px;">$${(invoice.subtotal || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;text-align:right;"><strong>Platform Fee:</strong></td>
          <td style="padding:4px 12px;text-align:right;">$${(invoice.platformFee || 0).toFixed(2)}</td>
        </tr>
        <tr style="font-size:16px;">
          <td style="padding:8px 0;text-align:right;border-top:2px solid #1a237e;"><strong>Total Due:</strong></td>
          <td style="padding:8px 12px;text-align:right;border-top:2px solid #1a237e;"><strong>$${(invoice.total || 0).toFixed(2)}</strong></td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:13px;color:#666;">Payment Terms: ${load.paymentTerms || 'Net 30 days'}</p>
      <p style="margin:0 0 24px;font-size:13px;color:#666;">Please log in to your FreightConnect dashboard to view the full invoice and make a payment.</p>

      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/shipper/payments"
         style="display:inline-block;background:#1a237e;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">
        View Invoice
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#f5f5f5;padding:16px 32px;font-size:12px;color:#999;text-align:center;">
      <p style="margin:0;">FreightConnect &middot; Connecting Shippers & Carriers Directly</p>
      <p style="margin:4px 0 0;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

async function runInvoiceEmailer() {
  console.log('[InvoiceEmailer] Running hourly invoice email check...');
  let sent = 0;

  try {
    // Find issued invoices that haven't been emailed yet
    const invoices = await Invoice.find({
      status:    'issued',
      emailedAt: { $exists: false },
    }).limit(50); // Process in batches to avoid overwhelming the email service

    for (const invoice of invoices) {
      try {
        const load = await Load.findById(invoice.loadId)
          .select('title origin destination status paymentTerms deliveredAt')
          .lean();

        if (!load || load.status !== 'delivered') continue;

        const shipper = await User.findById(invoice.shipperId)
          .select('name email companyName')
          .lean();

        if (!shipper || !shipper.email) {
          console.warn(`[InvoiceEmailer] No email for shipper ${invoice.shipperId}, skipping invoice ${invoice.invoiceNumber}`);
          continue;
        }

        const carrier = await User.findById(invoice.carrierId)
          .select('name companyName')
          .lean();

        const html = buildInvoiceHTML(invoice, load, shipper, carrier || { name: 'Carrier' });

        await sendEmail({
          to:      shipper.email,
          subject: `FreightConnect Invoice ${invoice.invoiceNumber} — $${(invoice.total || 0).toFixed(2)}`,
          html,
        });

        // Mark as emailed
        invoice.emailedAt = new Date();
        await invoice.save();

        sent++;
        console.log(`[InvoiceEmailer] Sent invoice ${invoice.invoiceNumber} to ${shipper.email}`);
      } catch (emailErr) {
        console.error(`[InvoiceEmailer] Failed to email invoice ${invoice.invoiceNumber}:`, emailErr.message);
        // Continue with next invoice — don't let one failure stop the batch
      }
    }

    console.log(`[InvoiceEmailer] Complete. Sent ${sent} invoice email(s).`);
  } catch (err) {
    console.error('[InvoiceEmailer] Error:', err.message);
  }
}

function start() {
  // Run every hour at :20 to stagger with other cron jobs
  cron.schedule('20 * * * *', runInvoiceEmailer);
  console.log('[InvoiceEmailer] Scheduled — runs every hour at :20');
}

module.exports = { start, runInvoiceEmailer };
