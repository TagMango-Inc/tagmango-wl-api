import 'dotenv/config';

import nodemailer from 'nodemailer';

// Create a transporter
const transporter = nodemailer.createTransport({
  service: 'Gmail', // Use your email service provider
  auth: {
    user: 'krishnendu.dakshi@tagmango.com', // Your email address
    pass: `${process.env.GMAIL_APP_PASSWORD}`,
  },
});

// Compose email
const mailOptions = {
  from: 'krishnendu.dakshi@tagmango.com', // Sender address
  to: 'kdakshi2020@gmail.com', // List of recipients
  subject: 'Test Email', // Subject line
  text: 'This is a test email.', // Plain text body
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Email sent:', info.response);
  }
});
