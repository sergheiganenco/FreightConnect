const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

exports.sendEmailWithAttachment = (to, subject, filePath) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: "Please find attached your document.",
    attachments: [{ path: filePath }],
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) return console.error("Email sending failed:", error);
    console.log("Email sent:", info.response);
  });
};
