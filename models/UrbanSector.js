const mongoose = require('mongoose');

const urbanSectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  city: { type: String, default: 'Islamabad' },
  areaType: { type: String, default: 'Urban' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UrbanSector', urbanSectorSchema);
