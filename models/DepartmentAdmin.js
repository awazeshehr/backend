const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const departmentAdminSchema = new mongoose.Schema({
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
    match: [/^[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF\u0600-\u06FF\s'.-]+$/, 'Name contains invalid characters']
  },
  role: {
    type: String,
    default: 'dept-admin',
    enum: ['dept-admin']
  },
  department: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  location: { type: String, default: '' },
  areaType: { type: String, enum: ['Urban', 'Rural'], default: 'Urban' },
  sector: { type: String, default: '' },
  ruralJurisdiction: { type: String, default: '' },
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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});



// Hash password before saving
departmentAdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
departmentAdminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('DepartmentAdmin', departmentAdminSchema, 'departmentadmins');
