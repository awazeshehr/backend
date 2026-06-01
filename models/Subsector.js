const mongoose = require('mongoose');

const subsectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'UrbanSector', required: true, index: true },
  city: { type: String, default: 'Islamabad' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

subsectorSchema.index({ sectorId: 1, name: 1 }, { unique: true });

subsectorSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Subsector', subsectorSchema);
