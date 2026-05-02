const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: function() {
      return this.role === 'citizen';
    },
    trim: true,
    minlength: 2,
    maxlength: 50,
    match: [/^[a-zA-Z\s]+$/, 'Name can only contain letters and spaces']
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email']
  },
  phone: {
    type: String,
    required: function() {
      return this.role === 'citizen';
    },
    validate: {
      validator: function(v) {
        if (!v && this.role === 'citizen') return false;
        if (!v) return true;
        const cleanPhone = v.replace(/[\s\-\(\)]/g, '');
        return /^(\+92|92|0)?3[0-9]{9}$/.test(cleanPhone);
      },
      message: 'Please provide a valid Pakistani mobile number'
    }
  },
  cnic: {
    type: String,
    required: function() {
      return this.role === 'citizen';
    },
    unique: function() {
      return this.role === 'citizen';
    },
    validate: {
      validator: function(v) {
        if (!v && this.role === 'citizen') return false;
        if (!v) return true;
        const cleanCNIC = v.replace(/[\s\-]/g, '');
        return /^[0-9]{13}$/.test(cleanCNIC) && cleanCNIC[0] !== '0';
      },
      message: 'CNIC must be exactly 13 digits without dashes and cannot start with 0'
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    validate: {
      validator: function(v) {
        return /(?=.*[a-zA-Z])(?=.*[0-9])/.test(v);
      },
      message: 'Password must contain at least one letter and one number'
    }
  },
  role: {
    type: String,
    required: true,
    enum: ['citizen', 'field-officer', 'dept-admin', 'super-admin'],
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  mustChangePassword: {
    type: Boolean,
    default: false,
  },
  department: {
    type: String,
    required: function() {
      return ['field-officer', 'dept-admin'].includes(this.role);
    }
  },
  address: {
    street: String,
    city: String,
    postalCode: String
  },
  areaType: { type: String, enum: ['Urban', 'Rural'], default: 'Urban' },
  sector: { type: String, default: '' },
  ruralJurisdiction: { type: String, default: '' },
  profilePicture: String,
  lastLogin: Date,
  loginCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update last login
userSchema.methods.updateLoginStats = function() {
  this.lastLogin = new Date();
  this.loginCount += 1;
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
