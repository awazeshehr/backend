const mongoose = require('mongoose');

const subsectorJurisdictionMappingSchema = new mongoose.Schema({
  subsectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsector', required: true, unique: true, index: true },
  departmentIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Department', default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

subsectorJurisdictionMappingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('SubsectorJurisdictionMapping', subsectorJurisdictionMappingSchema);
