const nodemailer = require('nodemailer');

// Create transporter - CORRECT SYNTAX
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const sendOTPEmail = async (email, otp, userName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Awaz e Shehr" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Awaz e Shehr - OTP Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <div style="text-align: center; background: linear-gradient(135deg, #2563eb, #1e40af); padding: 20px; border-radius: 10px 10px 0 0; color: white;">
            <h1 style="margin: 0; font-size: 28px;">Awaz e Shehr</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">National Complaint Management System</p>
          </div>
          
          <div style="padding: 30px 20px;">
            <h2 style="color: #333; text-align: center;">Email Verification</h2>
            <p>Hello <strong>${userName}</strong>,</p>
            <p>Your OTP for verifying your account with Awaz e Shehr is:</p>
            
            <div style="background: #f8fafc; padding: 20px; text-align: center; margin: 25px 0; border: 2px dashed #d1d5db; border-radius: 8px;">
              <h1 style="margin: 0; color: #2563eb; letter-spacing: 15px; font-size: 32px;">${otp}</h1>
            </div>
            
            <p style="color: #6b7280; text-align: center;">This OTP will expire in <strong>10 minutes</strong>.</p>
            <p style="color: #6b7280; text-align: center;">If you didn't request this, please ignore this email.</p>
          </div>
          
          <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 10px 10px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0; color: #6b7280;">Best regards,<br><strong>Awaz e Shehr Team</strong></p>
          </div>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ OTP email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error sending OTP email:', error);
    return false;
  }
};

module.exports = { sendOTPEmail };