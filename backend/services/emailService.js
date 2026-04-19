const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * sendEmail — send an HTML email (no attachments)
 * @param {{ to: string, subject: string, html: string }} opts
 * @returns {Promise<void>}
 */
exports.sendEmail = async ({ to, subject, html }) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  };
  const info = await transporter.sendMail(mailOptions);
  console.log('Email sent:', info.response);
};

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
