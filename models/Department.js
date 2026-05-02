const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  location: { type: String, default: '' },
  jurisdiction: { type: String, default: '' },
  areaTypes: { type: [String], enum: ['Urban', 'Rural'], default: ['Urban'] },
  sectors: { type: [String], default: [] }, // For Urban
  ruralJurisdictions: { type: [String], default: [] }, // For Rural
  servicesOffered: { type: [String], default: [] },
  adminIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'DepartmentAdmin', default: [] },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Department', departmentSchema);
