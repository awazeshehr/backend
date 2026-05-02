const mongoose = require('mongoose');

const systemPolicySchema = new mongoose.Schema({
  gpsToleranceMeters: { type: Number, default: 50 },
  slaHoursByCategory: {
    type: Map,
    of: Number,
    default: { water: 48, electricity: 24, roads: 72, sanitation: 48, waste: 72, other: 96 }
  },
  reminderHoursPending: { type: Number, default: 24 },
  escalateAfterHours: { type: Number, default: 96 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemPolicy', systemPolicySchema);
