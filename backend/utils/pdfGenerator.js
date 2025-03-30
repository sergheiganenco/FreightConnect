const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

exports.generateRateConfirmation = (load, carrier) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const filePath = path.join(__dirname, '../uploads', `RateConfirmation_${load._id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    doc.fontSize(18).text('Rate Confirmation', { align: 'center' }).moveDown();

    doc.fontSize(12)
      .text(`Load ID: ${load._id}`)
      .text(`Title: ${load.title}`)
      .text(`Carrier: ${carrier.name}`)
      .text(`Origin: ${load.origin}`)
      .text(`Destination: ${load.destination}`)
      .text(`Rate: $${load.rate}`)
      .text(`Pickup Date: ${load.pickupDate}`)
      .text(`Delivery Date: ${load.deliveryDate}`)
      .text(`Equipment: ${load.equipmentType}`)
      .moveDown()
      .text("Terms and conditions apply.", { align: 'left' });

    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
};
