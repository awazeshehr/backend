const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const FieldOfficer = require('../models/FieldOfficer');
const DepartmentAdmin = require('../models/DepartmentAdmin');
const SuperAdmin = require('../models/SuperAdmin');
const OTP = require('../models/OTP');
const { sendOTPEmail } = require('../utils/mailer');
const UrbanSector = require('../models/UrbanSector');
const RuralJurisdiction = require('../models/RuralJurisdiction');
const { 
  validateLoginIdentifier, 
  validateCitizenRegistration,
  validatePakistaniPhone,
  validateCNIC,
  validateEmail 
} = require('../utils/validation');
const { sendError, codes } = require('../utils/errorResponse');

const router = express.Router();

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Citizen password reset: request OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return res.status(400).json({ success: false, message: emailValidation.message });
    }

    const user = await User.findOne({ email, role: 'citizen' });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Password reset is only available for citizens' });
    }

    const otp = generateOTP();
    await OTP.findOneAndUpdate(
      { email },
      { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true, new: true }
    );

    try { await sendOTPEmail(email, otp, user.fullName || 'Citizen'); } catch (e) { }

    return res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error during password reset request' });
  }
});

// Citizen password reset: verify OTP
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email, role: 'citizen' });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Password reset is only available for citizens' });
    }
    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }
    return res.json({ success: true, message: 'OTP verified' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error during OTP verification' });
  }
});

// Citizen password reset: set new password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;
    const user = await User.findOne({ email, role: 'citizen' });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Password reset is only available for citizens' });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'New password and confirmation are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match' });
    }
    const pwdValidation = require('../utils/validation').validatePassword(newPassword);
    if (!pwdValidation.isValid) {
      return res.status(400).json({ success: false, message: pwdValidation.message });
    }

    const otpRecord = await OTP.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    await user.save();
    await OTP.deleteOne({ _id: otpRecord._id });

    return res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error while resetting password' });
  }
});

// Login user - All roles
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Try to find user across all role collections
    let user = null;
    let role = null;

    // Citizen: supports email, phone, or CNIC
    const citizen = await User.findOne({
      $or: [
        { email: identifier },
        { phone: identifier },
        { cnic: identifier }
      ],
      role: 'citizen'
    });
    if (citizen) {
      user = citizen;
      role = 'citizen';
    }

    // Field Officer: email only
    if (!user) {
      const fo = await FieldOfficer.findOne({ email: identifier });
      if (fo) { user = fo; role = 'field-officer'; }
    }

    // Department Admin: email only
    if (!user) {
      const da = await DepartmentAdmin.findOne({ email: identifier });
      if (da) { user = da; role = 'dept-admin'; }
    }

    // Super Admin: email only
    if (!user) {
      const sa = await SuperAdmin.findOne({ email: identifier });
      if (sa) { user = sa; role = 'super-admin'; }
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials - User not found' });
    }

    // Check if blocked
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Your account has been blocked by the administrator.' });
    }

    // Check if active (for non-citizen roles where isActive is relevant and blocked is not the only reason for inactivity)
    if (role !== 'citizen' && user.isActive === false) {
       return res.status(403).json({ success: false, message: 'Your account is inactive. Please contact support.' });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ success: false, message: 'Invalid credentials - Wrong password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        cnic: user.cnic,
        role,
        mustChangePassword: !!user.mustChangePassword,
        department: user.department
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// Public endpoints for Area Types
router.get('/urban-sectors', async (req, res) => {
  try {
    const list = await UrbanSector.find({}).sort({ name: 1 });
    res.json({ success: true, sectors: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch sectors' });
  }
});

router.get('/rural-jurisdictions', async (req, res) => {
  try {
    const list = await RuralJurisdiction.find({}).sort({ name: 1 });
    res.json({ success: true, jurisdictions: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch jurisdictions' });
  }
});

// Citizen registration with validation
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, cnic, password, confirmPassword, areaType, sector, ruralJurisdiction } = req.body;

    // Validate all registration fields
    const validation = validateCitizenRegistration({
      fullName, email, phone, cnic, password, confirmPassword
    });

    if (!validation.isValid) {
      const msg = validation.errors[0] || 'Validation failed';
      let code = codes.REG_INVALID_INPUT_FORMAT.code;
      let field = undefined;
      if (/email/i.test(msg)) code = codes.REG_INVALID_EMAIL_FORMAT.code, field = 'email';
      else if (/password/i.test(msg)) code = codes.REG_PASSWORD_POLICY_VIOLATION.code, field = 'password';
      else if (/cnic/i.test(msg)) field = 'cnic';
      else if (/phone|mobile/i.test(msg)) field = 'phone';
      else if (/name/i.test(msg)) field = 'fullName';
      return sendError(req, res, 400, { code, message: msg, field });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { cnic }] 
    });
    
    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'cnic';
      return sendError(req, res, 409, { code: codes.REG_DUPLICATE_EMAIL.code, message: 'User with this email or CNIC already exists', field });
    }

    // Create new user
    const user = new User({
      fullName,
      email,
      phone,
      cnic,
      password,
      role: 'citizen',
      areaType: areaType || 'Urban',
      sector: (areaType === 'Urban') ? sector : '',
      ruralJurisdiction: (areaType === 'Rural') ? ruralJurisdiction : ''
    });

    try {
      await user.save();
    } catch (err) {
      console.error('Register save error:', err);
      if (err && err.code === 11000) {
        const field = err.keyPattern?.email ? 'email' : err.keyPattern?.cnic ? 'cnic' : 'field';
        const code = field === 'email' ? codes.REG_DUPLICATE_EMAIL.code : codes.REG_DUPLICATE_USERNAME.code;
        return sendError(req, res, 409, { code, message: `${field} already exists`, field });
      }
      return sendError(req, res, 500, { code: codes.REG_DB_INSERT_FAILED.code, message: codes.REG_DB_INSERT_FAILED.message });
    }

    // Generate and send OTP
    const otp = generateOTP();
    const otpRecord = new OTP({
      email: user.email,
      otp
    });

    try {
      await otpRecord.save();
    } catch (e) {
      console.error('Register OTP save error:', e);
    }
    try {
      await sendOTPEmail(user.email, otp, user.fullName);
    } catch (e) {
      console.error('Register OTP email error:', e);
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful. OTP sent to email.',
      userId: user._id
    });
  } catch (error) {
    console.error('Registration error:', error);
    return sendError(req, res, 500, { code: codes.REG_UNKNOWN_ERROR.code, message: 'Server error during registration' });
  }
});

// Availability check for email (username reserved for future)
router.get('/check-availability', async (req, res) => {
  try {
    const { email } = req.query;
    const result = { emailAvailable: true };
    if (email) {
      const exists = await User.exists({ email: String(email).toLowerCase() });
      result.emailAvailable = !exists;
    }
    return res.json({ success: true, data: result });
  } catch (e) {
    return sendError(req, res, 500, { code: codes.REG_UNKNOWN_ERROR.code, message: 'Failed to check availability' });
  }
});

// OTP verification (existing code for citizens - unchanged)
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const otpRecord = await OTP.findOne({ 
      email, 
      otp 
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Update user verification status
    await User.findOneAndUpdate(
      { email },
      { isVerified: true }
    );

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    res.json({
      success: true,
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during OTP verification'
    });
  }
});

// Resend OTP (existing code for citizens - unchanged)
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    await OTP.findOneAndUpdate(
      { email },
      { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true, new: true }
    );

    await sendOTPEmail(email, otp, user.fullName);

    res.json({
      success: true,
      message: 'OTP resent successfully'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while resending OTP'
    });
  }
});

// Simplified social login for Google/Facebook
router.post('/social-login', async (req, res) => {
  try {
    const { provider, email, fullName } = req.body;

    if (!provider || !email || !fullName) {
      return res.status(400).json({ success: false, message: 'provider, email and fullName are required' });
    }

    let user = await User.findOne({ email, role: 'citizen' });

    if (!user) {
      const randomPhone = '03' + String(Math.floor(100000000 + Math.random() * 900000000));
      const firstDigit = String(Math.floor(1 + Math.random() * 8));
      let rest = '';
      for (let i = 0; i < 12; i++) { rest += String(Math.floor(Math.random() * 10)); }
      const randomCNIC = firstDigit + rest;
      const randomPassword = crypto.randomBytes(12).toString('hex');

      user = new User({
        fullName,
        email,
        phone: randomPhone,
        cnic: randomCNIC,
        password: randomPassword,
        role: 'citizen',
        isVerified: true
      });

      try {
        await user.save();
      } catch (err) {
        if (err && err.code === 11000) {
          return res.status(409).json({ success: false, message: 'Duplicate key error while creating social user' });
        }
        return res.status(500).json({ success: false, message: 'Failed to create social user' });
      }
    }

    const token = jwt.sign(
      { userId: user._id, role: 'citizen', email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Social login successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: 'citizen'
      }
    });

  } catch (error) {
    console.error('Social login error:', error);
    res.status(500).json({ success: false, message: 'Server error during social login' });
  }
});

module.exports = router;
// Bootstrap: create initial super admin (only if none exists and enabled)
router.post('/bootstrap-superadmin', async (req, res) => {
  try {
    if (process.env.ALLOW_BOOTSTRAP !== 'true') {
      return res.status(403).json({ success: false, message: 'Bootstrap disabled' });
    }
    const existing = await SuperAdmin.countDocuments();
    if (existing > 0) {
      return res.status(400).json({ success: false, message: 'Super admin already exists' });
    }
    const { email, password, fullName } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'email, password, fullName required' });
    }
    const sa = new SuperAdmin({ email, password, fullName });
    await sa.save();
    res.status(201).json({ success: true, user: { id: sa._id, email: sa.email, fullName: sa.fullName } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to bootstrap super admin' });
  }
});

router.post('/reset-superadmin', async (req, res) => {
  try {
    if (process.env.ALLOW_BOOTSTRAP !== 'true') {
      return res.status(403).json({ success: false, message: 'Bootstrap disabled' });
    }
    const { email, password, fullName } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'email, password, fullName required' });
    }
    await SuperAdmin.deleteMany({});
    const sa = new SuperAdmin({ email, password, fullName });
    await sa.save();
    res.status(201).json({ success: true, user: { id: sa._id, email: sa.email, fullName: sa.fullName } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to reset super admin' });
  }
});
