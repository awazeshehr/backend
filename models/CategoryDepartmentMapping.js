const mongoose = require('mongoose');

const categoryDepartmentMappingSchema = new mongoose.Schema({
  categoryName: { type: String, required: true, trim: true },
  categoryKey: { type: String, required: true, trim: true, lowercase: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  createdAt: { type: Date, default: Date.now }
});

categoryDepartmentMappingSchema.index({ categoryKey: 1 }, { unique: true });

categoryDepartmentMappingSchema.pre('validate', function (next) {
  const name = String(this.categoryName || '').trim();
  this.categoryName = name;
  this.categoryKey = name.toLowerCase();
  next();
});

module.exports = mongoose.model('CategoryDepartmentMapping', categoryDepartmentMappingSchema);
