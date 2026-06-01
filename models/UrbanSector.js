const mongoose = require('mongoose');

const urbanSectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  city: { type: String, default: 'Islamabad' },
  areaType: { type: String, default: 'Urban' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

urbanSectorSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('UrbanSector', urbanSectorSchema);
