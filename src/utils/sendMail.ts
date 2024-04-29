import 'dotenv/config';

import nodemailer from 'nodemailer';

// Create a transporter
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: 'krishnendu.dakshi@tagmango.com',
    pass: `${process.env.GMAIL_APP_PASSWORD}`,
  },
});

function sendMail({
  recipient,
  subject,
  text,
}: {
  recipient: string;
  subject: string;
  text: string;
}) {
  // Compose email
  const mailOptions = {
    from: 'krishnendu.dakshi@tagmango.com',
    to: recipient,
    subject: subject,
    text: text,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

export default sendMail;
