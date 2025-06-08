const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

exports.generateBOL = (load) => {
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, '../public/documents/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${load._id}-bol.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    doc.fontSize(18).text('Bill of Lading', { align: 'center' }).moveDown();
    doc.fontSize(12)
      .text(`Load ID: ${load._id}`)
      .text(`Title: ${load.title}`)
      .text(`Origin: ${load.origin}`)
      .text(`Destination: ${load.destination}`)
      .text(`Rate: $${load.rate}`)
      .text(`Pickup Date: ${load.pickupDate}`)
      .text(`Delivery Date: ${load.deliveryDate}`)
      .moveDown()
      .text("Terms and conditions apply.", { align: 'left' });

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
};
