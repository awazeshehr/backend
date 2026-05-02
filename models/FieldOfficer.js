const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const fieldOfficerSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 50,
    match: [/^[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u0600-\u06FF\s'.-]+$/, 'Name can contain letters, numbers, spaces, apostrophes, dots, and hyphens']
  },
  role: {
    type: String,
    default: 'field-officer',
    enum: ['field-officer']
  },
  department: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  wageType: {
    type: String,
    enum: ['Monthly', 'Weekly', 'Hourly'],
    default: 'Monthly'
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
  mustChangePassword: {
    type: Boolean,
    default: false,
  },
  currentLocation: {
    lat: Number,
    lng: Number,
    address: String,
    updatedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});



// Indexes to allow fast lookup by jurisdiction
fieldOfficerSchema.index({ department: 1 });
fieldOfficerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
fieldOfficerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('FieldOfficer', fieldOfficerSchema, 'fieldofficers');
