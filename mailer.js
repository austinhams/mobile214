'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Configured from environment variables.  In development, if SMTP_HOST is not
// set the transporter falls back to Ethereal (https://ethereal.email) — a
// catch-all test service — so emails are never delivered but are viewable via
// the preview URL logged to stdout.
let transporter;

async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Development fallback: create a one-time Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    logger.info({ user: testAccount.user }, 'Using Ethereal test SMTP account');
  }
  return transporter;
}

async function sendVerificationEmail(toEmail, verifyUrl) {
  const from = process.env.SMTP_FROM || 'noreply@mobile214.local';
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from,
    to: toEmail,
    subject: 'Verify your mobile214 email address',
    text: `Please verify your email by visiting:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <p>Thanks for registering with <strong>mobile214</strong>.</p>
      <p>Please verify your email address by clicking the link below:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 24 hours. If you did not register, you can safely ignore this email.</p>
    `,
  });
  // In development, log the Ethereal preview URL so the email can be inspected.
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) logger.info({ preview }, 'Verification email preview (Ethereal)');
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const from = process.env.SMTP_FROM || 'noreply@mobile214.local';
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from,
    to: toEmail,
    subject: 'Reset your mobile214 password',
    text: `You requested a password reset. Visit the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can safely ignore this email.`,
    html: `
      <p>You requested a password reset for your <strong>mobile214</strong> account.</p>
      <p>Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
    `,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) logger.info({ preview }, 'Password reset email preview (Ethereal)');
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
