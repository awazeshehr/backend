const mongoose = require('mongoose');

const ruralJurisdictionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  city: { type: String, default: 'Islamabad' },
  areaType: { type: String, default: 'Rural' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RuralJurisdiction', ruralJurisdictionSchema);
