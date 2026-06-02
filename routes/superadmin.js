const express = require('express');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const User = require('../models/User');
const FieldOfficer = require('../models/FieldOfficer');
const DepartmentAdmin = require('../models/DepartmentAdmin');
const SuperAdmin = require('../models/SuperAdmin');
const Complaint = require('../models/Complaint');
const Department = require('../models/Department');
const CategoryDepartmentMapping = require('../models/CategoryDepartmentMapping');
const Notification = require('../models/Notification');

const router = express.Router();

// Ensure super-admin access for all routes
router.use(auth, authorize('super-admin'));

const mongoose = require('mongoose');
const RoutingPolicy = require('../models/RoutingPolicy');
const UrbanSector = require('../models/UrbanSector');
const RuralJurisdiction = require('../models/RuralJurisdiction');
const Subsector = require('../models/Subsector');
const SubsectorJurisdictionMapping = require('../models/SubsectorJurisdictionMapping');
const SystemPolicy = require('../models/SystemPolicy');
const AuditLog = require('../models/AuditLog');

function audit(req, action, entityType, entityId, payload) {
  try {
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action,
      entityType,
      entityId,
      payload
    });
  } catch (e) {}
}

function buildDepartmentJurisdiction(areaTypes, sectors, ruralJurisdictions) {
  const types = Array.isArray(areaTypes) ? areaTypes : [];
  const parts = [];
  if (types.includes('Urban')) {
    const s = Array.isArray(sectors) ? sectors.filter(Boolean) : [];
    parts.push(`Urban: ${s.length ? s.join(', ') : 'All sectors'}`);
  }
  if (types.includes('Rural')) {
    const r = Array.isArray(ruralJurisdictions) ? ruralJurisdictions.filter(Boolean) : [];
    parts.push(`Rural: ${r.length ? r.join(', ') : 'All jurisdictions'}`);
  }
  return parts.join(' | ');
}

function validateIslamabadLocationText(location, areaTypes, sectors, ruralJurisdictions) {
  const loc = String(location || '').trim();
  if (!loc) return { ok: false, message: 'Location is required' };
  const lower = loc.toLowerCase();
  const sectorList = Array.isArray(sectors) ? sectors.map(s => String(s || '').trim().toLowerCase()).filter(Boolean) : [];
  const ruralList = Array.isArray(ruralJurisdictions) ? ruralJurisdictions.map(s => String(s || '').trim().toLowerCase()).filter(Boolean) : [];
  const mentionsCoverage = sectorList.some(s => lower.includes(s)) || ruralList.some(r => lower.includes(r));
  const mentionsIslamabadMetro =
    lower.includes('islamabad') ||
    lower.includes('islamabad capital territory') ||
    lower.includes('capital territory') ||
    lower.includes('ict') ||
    lower.includes('rawalpindi');
  const mentionsPakistan = lower.includes('pakistan');
  if (!mentionsIslamabadMetro && !mentionsCoverage && !mentionsPakistan) {
    return { ok: false, message: 'Department address must be within Islamabad (include Islamabad/ICT/Rawalpindi, Pakistan, or your selected sector/jurisdiction)' };
  }

  return { ok: true };
}

// Urban Sectors
router.post('/urban-sectors', async (req, res) => {
  try {
    const { name } = req.body;
    const sector = await UrbanSector.create({ name });
    audit(req, 'create', 'urbanSector', sector._id, { name });
    res.status(201).json({ success: true, sector });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Sector already exists' });
    res.status(500).json({ success: false, message: 'Failed to create sector' });
  }
});

router.get('/urban-sectors', async (req, res) => {
  const list = await UrbanSector.find({}).sort({ name: 1 });
  res.json({ success: true, sectors: list });
});

router.put('/urban-sectors/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const sector = await UrbanSector.findByIdAndUpdate(req.params.id, { name }, { new: true });
    audit(req, 'update', 'urbanSector', sector._id, { name });
    res.json({ success: true, sector });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Sector already exists' });
    res.status(500).json({ success: false, message: 'Failed to update sector' });
  }
});

router.delete('/urban-sectors/:id', async (req, res) => {
  try {
    const sectorId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sectorId)) {
      return res.status(400).json({ success: false, message: 'Invalid sector id' });
    }
    const subs = await Subsector.find({ sectorId }).select('_id');
    const subsectorIds = (subs || []).map(s => s._id).filter(Boolean);
    if (subsectorIds.length > 0) {
      await SubsectorJurisdictionMapping.deleteMany({ subsectorId: { $in: subsectorIds } });
      await Subsector.deleteMany({ sectorId });
    }
    await UrbanSector.findByIdAndDelete(sectorId);
    audit(req, 'delete', 'urbanSector', sectorId, { deletedSubsectors: subsectorIds.length });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete sector' });
  }
});

// Urban Subsectors
router.get('/urban-sectors/:sectorId/subsectors', async (req, res) => {
  try {
    const { sectorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sectorId)) {
      return res.status(400).json({ success: false, message: 'Invalid sectorId' });
    }
    const list = await Subsector.find({ sectorId }).sort({ name: 1 });
    res.json({ success: true, subsectors: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list subsectors' });
  }
});

router.post('/subsectors', async (req, res) => {
  try {
    const { name, sectorId, status } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Subsector name is required' });
    if (!sectorId || !mongoose.Types.ObjectId.isValid(sectorId)) return res.status(400).json({ success: false, message: 'Valid sectorId is required' });

    const sector = await UrbanSector.findById(sectorId).select('_id name city');
    if (!sector) return res.status(404).json({ success: false, message: 'Sector not found' });

    const subsector = await Subsector.create({
      name: String(name).trim(),
      sectorId,
      city: sector.city || 'Islamabad',
      status: status === 'inactive' ? 'inactive' : 'active'
    });
    audit(req, 'create', 'subsector', subsector._id, { name: subsector.name, sectorId });
    res.status(201).json({ success: true, subsector });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Subsector already exists in this sector' });
    res.status(500).json({ success: false, message: 'Failed to create subsector' });
  }
});

router.post('/urban-sectors/:sectorId/subsectors/auto-generate', async (req, res) => {
  try {
    const { sectorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sectorId)) {
      return res.status(400).json({ success: false, message: 'Invalid sectorId' });
    }

    const sector = await UrbanSector.findById(sectorId).select('_id name city');
    if (!sector) return res.status(404).json({ success: false, message: 'Sector not found' });

    const base = String(sector.name || '').trim();
    if (!base) return res.status(400).json({ success: false, message: 'Sector name is required to generate subsectors' });

    const toCreate = [1, 2, 3, 4].map(n => ({
      name: `${base}/${n}`,
      sectorId: sector._id,
      city: sector.city || 'Islamabad',
      status: 'active'
    }));

    let insertedCount = 0;
    try {
      const inserted = await Subsector.insertMany(toCreate, { ordered: false });
      insertedCount = Array.isArray(inserted) ? inserted.length : 0;
    } catch (e) {
      const writeErrors = Array.isArray(e?.writeErrors) ? e.writeErrors : [];
      insertedCount = Math.max(0, toCreate.length - writeErrors.length);
    }

    audit(req, 'create', 'subsector:auto-generate', sectorId, { sectorName: base, created: insertedCount });
    const list = await Subsector.find({ sectorId }).sort({ name: 1 });
    res.json({ success: true, created: insertedCount, subsectors: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to auto-generate subsectors' });
  }
});

router.put('/subsectors/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const { name, status } = req.body || {};
    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (status === 'active' || status === 'inactive') updates.status = status;
    if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'No updates provided' });

    const subsector = await Subsector.findByIdAndUpdate(id, updates, { new: true });
    if (!subsector) return res.status(404).json({ success: false, message: 'Subsector not found' });
    audit(req, 'update', 'subsector', id, updates);
    res.json({ success: true, subsector });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Subsector already exists in this sector' });
    res.status(500).json({ success: false, message: 'Failed to update subsector' });
  }
});

router.delete('/subsectors/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    await SubsectorJurisdictionMapping.findOneAndDelete({ subsectorId: id });
    await Subsector.findByIdAndDelete(id);
    audit(req, 'delete', 'subsector', id, {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete subsector' });
  }
});

// Subsector ↔ Department mapping
router.get('/subsectors/:id/jurisdictions', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const mapping = await SubsectorJurisdictionMapping.findOne({ subsectorId: id }).select('subsectorId departmentIds');
    res.json({ success: true, mapping: mapping || { subsectorId: id, departmentIds: [] } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to get mapping' });
  }
});

router.put('/subsectors/:id/jurisdictions', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const raw = Array.isArray(req.body?.departmentIds) ? req.body.departmentIds : [];
    const departmentIds = raw
      .map(x => String(x || '').trim())
      .filter(Boolean)
      .filter(x => mongoose.Types.ObjectId.isValid(x))
      .map(x => new mongoose.Types.ObjectId(x));

    const mapping = await SubsectorJurisdictionMapping.findOneAndUpdate(
      { subsectorId: id },
      { subsectorId: id, departmentIds, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select('subsectorId departmentIds');

    audit(req, 'update', 'subsectorJurisdictionMapping', id, { departmentIds: departmentIds.map(String) });
    res.json({ success: true, mapping });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save mapping' });
  }
});

// Rural Jurisdictions
router.post('/rural-jurisdictions', async (req, res) => {
  try {
    const { name } = req.body;
    const jurisdiction = await RuralJurisdiction.create({ name });
    audit(req, 'create', 'ruralJurisdiction', jurisdiction._id, { name });
    res.status(201).json({ success: true, jurisdiction });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Jurisdiction already exists' });
    res.status(500).json({ success: false, message: 'Failed to create jurisdiction' });
  }
});

router.get('/rural-jurisdictions', async (req, res) => {
  const list = await RuralJurisdiction.find({}).sort({ name: 1 });
  res.json({ success: true, jurisdictions: list });
});

router.put('/rural-jurisdictions/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const jurisdiction = await RuralJurisdiction.findByIdAndUpdate(req.params.id, { name }, { new: true });
    audit(req, 'update', 'ruralJurisdiction', jurisdiction._id, { name });
    res.json({ success: true, jurisdiction });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Jurisdiction already exists' });
    res.status(500).json({ success: false, message: 'Failed to update jurisdiction' });
  }
});

router.delete('/rural-jurisdictions/:id', async (req, res) => {
  try {
    await RuralJurisdiction.findByIdAndDelete(req.params.id);
    audit(req, 'delete', 'ruralJurisdiction', req.params.id, {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete jurisdiction' });
  }
});

// Create user (dept-admin or field-officer)
router.post('/users', async (req, res) => {
  try {
    const { role, fullName, email, password, department, departmentId, areaType, sector, ruralJurisdiction } = req.body;
    if (!role || !email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    if (role !== 'dept-admin' && role !== 'field-officer') {
      return res.status(403).json({ success: false, message: 'Super Admin can only register Department Admins or Field Officers.' });
    }
    
    if (!department && !departmentId) return res.status(400).json({ success: false, message: 'Department is required' });
    
    let doc;
    if (role === 'dept-admin') {
      let depName = department;
      let depId = departmentId;
      let depDoc = null;
      if (depId) {
        depDoc = await Department.findById(depId).select('name location');
        if (!depDoc) return res.status(400).json({ success: false, message: 'Department not found' });
        depName = depDoc.name;
      } else if (depName) {
        depDoc = await Department.findOne({ name: depName }).select('name location');
        if (!depDoc) return res.status(400).json({ success: false, message: 'Department not found' });
        depId = depDoc._id;
      } else {
        return res.status(400).json({ success: false, message: 'Department is required' });
      }

      // Check for existing admin in this area if areaType is provided
      if (areaType) {
         const query = { departmentId: depId, areaType };
         if (areaType === 'Urban') query.sector = sector || '';
         if (areaType === 'Rural') query.ruralJurisdiction = ruralJurisdiction || '';
         
         const existing = await DepartmentAdmin.findOne(query);
         if (existing) {
             return res.status(400).json({ success: false, message: `An admin already exists for this Department in ${areaType} area (${sector || ruralJurisdiction || 'General'}).` });
         }
      }

      doc = new DepartmentAdmin({ 
        fullName, email, password, 
        department: depName, departmentId: depId, 
        location: depDoc.location || '',
        areaType,
        sector: areaType === 'Urban' ? sector : '',
        ruralJurisdiction: areaType === 'Rural' ? ruralJurisdiction : ''
      });
    } else {
      doc = new FieldOfficer({ fullName, email, password, department });
    }
    
    await doc.save();
    audit(req, 'create', role, doc._id, { fullName, email, department, departmentId });
    res.status(201).json({ success: true, user: { id: doc._id, role, email, fullName, department } });
  } catch (e) {
    console.error('Create user error:', e);
    // Check for duplicate email error (MongoDB code 11000)
    if (e.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already exists.' });
    }
    if (e.name === 'ValidationError') {
      const first = e.errors && Object.values(e.errors)[0];
      const msg = (first && first.message) || 'Validation failed';
      return res.status(400).json({ success: false, message: msg });
    }
    res.status(500).json({ success: false, message: e?.message || 'Failed to create user' });
  }
});

// List users by role
router.get('/users', async (req, res) => {
  try {
    const { role } = req.query;
    let list;
    if (role === 'dept-admin') list = await DepartmentAdmin.find({});
    else if (role === 'field-officer') list = await FieldOfficer.find({});
    else if (role === 'citizen') list = await User.find({});
    else if (role === 'super-admin') list = await SuperAdmin.find({});
    else return res.status(400).json({ success: false, message: 'Unsupported role' });
    res.json({ success: true, users: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list users' });
  }
});

// Block / Unblock user
router.patch('/users/:role/:id/block', async (req, res) => {
  try {
    const { role, id } = req.params;
    const { block } = req.body;
    const Model = role === 'dept-admin' ? DepartmentAdmin : role === 'field-officer' ? FieldOfficer : role === 'citizen' ? User : null;
    if (!Model) return res.status(400).json({ success: false, message: 'Unsupported role' });
    const user = await Model.findByIdAndUpdate(id, { isBlocked: !!block, isActive: block === true ? false : true }, { new: true });
    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update user block status' });
  }
});

// Reset password / force change
router.post('/users/:role/:id/reset-password', async (req, res) => {
  try {
    const { role, id } = req.params;
    const { newPassword } = req.body;
    const Model = role === 'dept-admin' ? DepartmentAdmin : role === 'field-officer' ? FieldOfficer : role === 'citizen' ? User : null;
    if (!Model) return res.status(400).json({ success: false, message: 'Unsupported role' });
    const hashed = await bcrypt.hash(newPassword, 12);
    const user = await Model.findByIdAndUpdate(id, { password: hashed, mustChangePassword: true }, { new: true });
    res.json({ success: true, user: { id: user._id } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// Departments CRUD
router.post('/departments', async (req, res) => {
  try {
    const { name, location, servicesOffered, areaTypes, sectors, ruralJurisdictions, addressValidated } = req.body;
    
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!Array.isArray(areaTypes) || areaTypes.length === 0) {
      return res.status(400).json({ success: false, message: 'Operational area type is required' });
    }
    const nextSectors = areaTypes.includes('Urban') ? (Array.isArray(sectors) ? sectors : []) : [];
    const nextRuralJurisdictions = areaTypes.includes('Rural') ? (Array.isArray(ruralJurisdictions) ? ruralJurisdictions : []) : [];

    // Validation
    if (areaTypes && areaTypes.includes('Urban') && nextSectors.length > 0) {
        const sectorCount = await UrbanSector.countDocuments({ name: { $in: nextSectors } });
        if (sectorCount !== sectors.length) {
             return res.status(400).json({ success: false, message: 'One or more invalid Urban Sectors provided.' });
        }
    }
    if (areaTypes && areaTypes.includes('Rural') && nextRuralJurisdictions.length > 0) {
        const jurisdictionCount = await RuralJurisdiction.countDocuments({ name: { $in: nextRuralJurisdictions } });
        if (jurisdictionCount !== ruralJurisdictions.length) {
             return res.status(400).json({ success: false, message: 'One or more invalid Rural Jurisdictions provided.' });
        }
    }

    if (addressValidated !== true) {
      const locCheck = validateIslamabadLocationText(location, areaTypes, nextSectors, nextRuralJurisdictions);
      if (!locCheck.ok) return res.status(400).json({ success: false, message: locCheck.message });
    }
    const computedJurisdiction = buildDepartmentJurisdiction(areaTypes, nextSectors, nextRuralJurisdictions);

    const dep = await Department.create({ 
      name, 
      location, 
      jurisdiction: computedJurisdiction,
      servicesOffered, 
      areaTypes: areaTypes || ['Urban'],
      sectors: nextSectors,
      ruralJurisdictions: nextRuralJurisdictions
    });
    audit(req, 'create', 'department', dep._id, { name, areaTypes });
    res.status(201).json({ success: true, department: dep });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Department already exists' });
    res.status(500).json({ success: false, message: 'Failed to create department' });
  }
});

router.put('/departments/:id', async (req, res) => {
  try {
    const updates = req.body;

    const existing = await Department.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Department not found' });

    const nextAreaTypes = Array.isArray(updates.areaTypes) ? updates.areaTypes : (existing.areaTypes || []);
    const nextSectors = nextAreaTypes.includes('Urban')
      ? (Array.isArray(updates.sectors) ? updates.sectors : (existing.sectors || []))
      : [];
    const nextRuralJurisdictions = nextAreaTypes.includes('Rural')
      ? (Array.isArray(updates.ruralJurisdictions) ? updates.ruralJurisdictions : (existing.ruralJurisdictions || []))
      : [];
    const nextLocation = typeof updates.location === 'string' ? updates.location : (existing.location || '');

    if (!Array.isArray(nextAreaTypes) || nextAreaTypes.length === 0) {
      return res.status(400).json({ success: false, message: 'Operational area type is required' });
    }

    if (nextAreaTypes.includes('Urban') && nextSectors.length > 0) {
      const sectorCount = await UrbanSector.countDocuments({ name: { $in: nextSectors } });
      if (sectorCount !== nextSectors.length) {
        return res.status(400).json({ success: false, message: 'One or more invalid Urban Sectors provided.' });
      }
    }
    if (nextAreaTypes.includes('Rural') && nextRuralJurisdictions.length > 0) {
      const jurisdictionCount = await RuralJurisdiction.countDocuments({ name: { $in: nextRuralJurisdictions } });
      if (jurisdictionCount !== nextRuralJurisdictions.length) {
        return res.status(400).json({ success: false, message: 'One or more invalid Rural Jurisdictions provided.' });
      }
    }

    if (updates.addressValidated !== true) {
      const locCheck = validateIslamabadLocationText(nextLocation, nextAreaTypes, nextSectors, nextRuralJurisdictions);
      if (!locCheck.ok) return res.status(400).json({ success: false, message: locCheck.message });
    }
    const computedJurisdiction = buildDepartmentJurisdiction(nextAreaTypes, nextSectors, nextRuralJurisdictions);

    const { addressValidated, ...restUpdates } = updates || {};
    const computedUpdates = {
      ...restUpdates,
      location: nextLocation,
      areaTypes: nextAreaTypes,
      sectors: nextSectors,
      ruralJurisdictions: nextRuralJurisdictions,
      jurisdiction: computedJurisdiction
    };

    const dep = await Department.findByIdAndUpdate(req.params.id, computedUpdates, { new: true });
    audit(req, 'update', 'department', req.params.id, computedUpdates);
    res.json({ success: true, department: dep });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update department' });
  }
});

router.delete('/departments/:id', async (req, res) => {
  try {
    const dep = await Department.findById(req.params.id);
    if (!dep) return res.status(404).json({ success: false, message: 'Department not found' });

    await Department.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    await DepartmentAdmin.updateMany({ departmentId: dep._id }, { $unset: { departmentId: '' } });
    await SubsectorJurisdictionMapping.updateMany({}, { $pull: { departmentIds: dep._id } });
    await CategoryDepartmentMapping.deleteMany({ departmentId: dep._id });
    await RoutingPolicy.updateMany({ 'action.departmentId': dep._id }, { $set: { enabled: false, 'action.departmentId': null } });

    audit(req, 'delete', 'department', req.params.id, { isActive: false });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete department' });
  }
});

router.get('/departments', async (req, res) => {
  const list = await Department.find({});
  res.json({ success: true, departments: list });
});

router.post('/departments/:id/assign-admin', async (req, res) => {
  try {
    const { adminId } = req.body;
    const dep = await Department.findByIdAndUpdate(req.params.id, { $addToSet: { adminIds: adminId } }, { new: true });
    await DepartmentAdmin.findByIdAndUpdate(adminId, { departmentId: dep._id });
    audit(req, 'assign', 'departmentAdmin', adminId, { departmentId: dep._id });
    res.json({ success: true, department: dep });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to assign admin' });
  }
});

router.post('/departments/:id/remove-admin', async (req, res) => {
  try {
    const { adminId } = req.body;
    const dep = await Department.findByIdAndUpdate(req.params.id, { $pull: { adminIds: adminId } }, { new: true });
    await DepartmentAdmin.findByIdAndUpdate(adminId, { $unset: { departmentId: '' } });
    audit(req, 'remove', 'departmentAdmin', adminId, { departmentId: req.params.id });
    res.json({ success: true, department: dep });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to remove admin' });
  }
});

router.put('/departments/:id/categories', async (req, res) => {
  try {
    const { categories } = req.body;
    const dep = await Department.findByIdAndUpdate(req.params.id, { categories }, { new: true });
    audit(req, 'update-categories', 'department', req.params.id, { categories });
    res.json({ success: true, department: dep });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update categories' });
  }
});

const parseTimeToMinutes = (v) => {
  const raw = String(v || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
};

// Routing Policies
router.post('/routing-policies', async (req, res) => {
  try {
    const {
      name,
      priority = 100,
      match,
      conditions,
      action
    } = req.body || {};

    const categoryName = String(match?.categoryName || match?.categoryKey || '').trim();
    if (!categoryName) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }
    const actionType = String(action?.type || 'route');
    const departmentId = action?.departmentId || null;
    if (actionType === 'route' && !departmentId) {
      return res.status(400).json({ success: false, message: 'Department is required for route action' });
    }

    const policy = await RoutingPolicy.create({
      name: String(name || '').trim() || 'Routing Policy',
      priority: Number(priority) || 100,
      match: {
        categoryName,
        categoryKey: categoryName.toLowerCase(),
        areaType: String(match?.areaType || 'Any'),
        sector: String(match?.sector || '').trim(),
        ruralJurisdiction: String(match?.ruralJurisdiction || '').trim()
      },
      conditions: {
        allowedPriorities: Array.isArray(conditions?.allowedPriorities) ? conditions.allowedPriorities : [],
        keywords: Array.isArray(conditions?.keywords)
          ? conditions.keywords
          : String(conditions?.keywords || '')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
        maxOpenComplaints:
          conditions?.maxOpenComplaints === '' || conditions?.maxOpenComplaints == null
            ? null
            : Number(conditions.maxOpenComplaints),
        timeWindow: {
          daysOfWeek: Array.isArray(conditions?.timeWindow?.daysOfWeek) ? conditions.timeWindow.daysOfWeek : [],
          startMinutes: parseTimeToMinutes(conditions?.timeWindow?.startMinutes ?? conditions?.timeWindow?.startTime ?? null),
          endMinutes: parseTimeToMinutes(conditions?.timeWindow?.endMinutes ?? conditions?.timeWindow?.endTime ?? null)
        }
      },
      action: {
        type: actionType,
        departmentId: departmentId || null,
        note: String(action?.note || '').trim()
      },
      createdBy: req.user._id
    });

    audit(req, 'create', 'routingPolicy', policy._id, { name: policy.name, priority: policy.priority, actionType: policy.action?.type });
    const populated = await RoutingPolicy.findById(policy._id).populate('action.departmentId', 'name');
    res.status(201).json({ success: true, policy: populated });
  } catch (e) {
    console.error('Create routing policy error:', e);
    res.status(500).json({ success: false, message: 'Failed to create routing policy', error: e.message });
  }
});

// Category ↔ Department mapping
router.get('/category-mappings', async (req, res) => {
  try {
    const list = await CategoryDepartmentMapping.find({})
      .populate('departmentId', 'name')
      .sort({ categoryKey: 1 });
    res.json({ success: true, mappings: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to list category mappings' });
  }
});

router.post('/category-mappings', async (req, res) => {
  try {
    const { categoryName, departmentId } = req.body;
    if (!categoryName || !departmentId) {
      return res.status(400).json({ success: false, message: 'categoryName and departmentId are required' });
    }
    const name = String(categoryName || '').trim();
    const key = name.toLowerCase();

    const doc = await CategoryDepartmentMapping.findOneAndUpdate(
      { categoryKey: key },
      { categoryName: name, departmentId },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('departmentId', 'name');

    audit(req, 'upsert', 'categoryDepartmentMapping', doc._id, { categoryName: name, departmentId });
    res.status(201).json({ success: true, mapping: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save category mapping' });
  }
});

router.delete('/category-mappings/:id', async (req, res) => {
  try {
    await CategoryDepartmentMapping.findByIdAndDelete(req.params.id);
    audit(req, 'delete', 'categoryDepartmentMapping', req.params.id, {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete category mapping' });
  }
});

router.get('/routing-policies', async (req, res) => {
  const policies = await RoutingPolicy.find({})
    .populate('action.departmentId', 'name')
    .sort({ priority: 1, updatedAt: -1 });
  res.json({ success: true, policies });
});

router.patch('/routing-policies/:id', async (req, res) => {
  try {
    const updates = req.body || {};
    const allowed = {};

    if (typeof updates.enabled === 'boolean') allowed.enabled = updates.enabled;
    if (updates.name != null) allowed.name = String(updates.name || '').trim();
    if (updates.priority != null) allowed.priority = Number(updates.priority) || 100;

    if (updates.match) {
      allowed.match = {};
      if (updates.match.categoryName != null) {
        const c = String(updates.match.categoryName || '').trim();
        allowed.match.categoryName = c;
        allowed.match.categoryKey = c.toLowerCase();
      }
      if (updates.match.areaType != null) allowed.match.areaType = String(updates.match.areaType || 'Any');
      if (updates.match.sector != null) allowed.match.sector = String(updates.match.sector || '').trim();
      if (updates.match.ruralJurisdiction != null) allowed.match.ruralJurisdiction = String(updates.match.ruralJurisdiction || '').trim();
    }

    if (updates.conditions) {
      allowed.conditions = {};
      if (updates.conditions.allowedPriorities != null) {
        allowed.conditions.allowedPriorities = Array.isArray(updates.conditions.allowedPriorities)
          ? updates.conditions.allowedPriorities
          : [];
      }
      if (updates.conditions.keywords != null) {
        allowed.conditions.keywords = Array.isArray(updates.conditions.keywords)
          ? updates.conditions.keywords
          : String(updates.conditions.keywords || '')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean);
      }
      if (updates.conditions.maxOpenComplaints != null) {
        allowed.conditions.maxOpenComplaints =
          updates.conditions.maxOpenComplaints === '' ? null : Number(updates.conditions.maxOpenComplaints);
      }
      if (updates.conditions.timeWindow) {
        allowed.conditions.timeWindow = {};
        if (updates.conditions.timeWindow.daysOfWeek != null) {
          allowed.conditions.timeWindow.daysOfWeek = Array.isArray(updates.conditions.timeWindow.daysOfWeek)
            ? updates.conditions.timeWindow.daysOfWeek
            : [];
        }
        if (updates.conditions.timeWindow.startMinutes != null || updates.conditions.timeWindow.startTime != null) {
          allowed.conditions.timeWindow.startMinutes = parseTimeToMinutes(
            updates.conditions.timeWindow.startMinutes ?? updates.conditions.timeWindow.startTime
          );
        }
        if (updates.conditions.timeWindow.endMinutes != null || updates.conditions.timeWindow.endTime != null) {
          allowed.conditions.timeWindow.endMinutes = parseTimeToMinutes(
            updates.conditions.timeWindow.endMinutes ?? updates.conditions.timeWindow.endTime
          );
        }
      }
    }

    if (updates.action) {
      allowed.action = {};
      if (updates.action.type != null) allowed.action.type = String(updates.action.type || 'route');
      if (updates.action.departmentId !== undefined) allowed.action.departmentId = updates.action.departmentId || null;
      if (updates.action.note != null) allowed.action.note = String(updates.action.note || '').trim();
    }

    const saved = await RoutingPolicy.findByIdAndUpdate(req.params.id, allowed, { new: true })
      .populate('action.departmentId', 'name');
    if (!saved) return res.status(404).json({ success: false, message: 'Routing policy not found' });
    audit(req, 'update', 'routingPolicy', saved._id, allowed);
    res.json({ success: true, policy: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update routing policy' });
  }
});

router.delete('/routing-policies/:id', async (req, res) => {
  try {
    const policy = await RoutingPolicy.findByIdAndDelete(req.params.id);
    audit(req, 'delete', 'routingPolicy', req.params.id, {});
    res.json({ success: true, deleted: !!policy });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to delete routing policy' });
  }
});

router.post('/routing-rules', async (req, res) => {
  res.status(410).json({ success: false, message: 'routing-rules has been replaced by routing-policies' });
});

router.get('/routing-rules', async (req, res) => {
  res.status(410).json({ success: false, message: 'routing-rules has been replaced by routing-policies' });
});

router.delete('/routing-rules/:id', async (req, res) => {
  res.status(410).json({ success: false, message: 'routing-rules has been replaced by routing-policies' });
});

// Policies
router.get('/policies', async (req, res) => {
  const policy = await SystemPolicy.findOne({});
  res.json({ success: true, policy });
});

router.put('/policies', async (req, res) => {
  try {
    const updates = { ...req.body, updatedBy: req.user._id, updatedAt: new Date() };
    const policy = await SystemPolicy.findOneAndUpdate({}, updates, { new: true, upsert: true });
    audit(req, 'update', 'systemPolicy', policy?._id, updates);
    res.json({ success: true, policy });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update policies' });
  }
});

router.get('/analytics/heatmap', async (req, res) => {
  try {
    const data = await Complaint.find({}).select('location.lat location.lng category status');
    res.json({ success: true, points: data.map(c => ({ lat: c.location.lat, lng: c.location.lng, category: c.category, status: c.status })) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch heatmap data' });
  }
});

// Audit logs
router.get('/audit-logs', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).skip(Number(offset)).limit(Number(limit));
    res.json({ success: true, logs });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

// Complaints management
router.get('/complaints', async (req, res) => {
  try {
    const { status, department } = req.query;
    const query = {};
    if (status) query.status = status;
    if (department) query.department = department;
    const list = await Complaint.find(query).sort({ createdAt: -1 });
    res.json({ success: true, complaints: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch complaints' });
  }
});

router.put('/complaints/:id/reopen', async (req, res) => {
  try {
    const comp = await Complaint.findByIdAndUpdate(req.params.id, { status: 'pending', reopenedAt: new Date() }, { new: true });
    res.json({ success: true, complaint: comp });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to reopen complaint' });
  }
});

// Analytics: complaint trends
router.get('/analytics/complaints', async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const groupFormat = period === 'weekly' ? '%Y-%V' : period === 'monthly' ? '%Y-%m' : '%Y-%m-%d';
    const pipeline = [
      { $group: { _id: { $dateToString: { format: groupFormat, date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ];
    const data = await Complaint.aggregate(pipeline);
    res.json({ success: true, series: data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch complaint trends' });
  }
});

// Analytics: department performance
router.get('/analytics/departments', async (req, res) => {
  try {
    const departments = await Department.find({});
    const results = [];
    for (const dep of departments) {
      const total = await Complaint.countDocuments({ department: dep.name });
      const resolved = await Complaint.countDocuments({ department: dep.name, status: 'resolved' });
      const pending = await Complaint.countDocuments({ department: dep.name, status: 'pending' });
      const inProgress = await Complaint.countDocuments({ department: dep.name, status: 'in-progress' });
      results.push({ department: dep.name, total, resolved, pending, inProgress, resolveRate: total ? (resolved / total) : 0 });
    }
    res.json({ success: true, performance: results });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch department performance' });
  }
});

router.get('/reroute-requests', async (req, res) => {
  try {
    const list = await Complaint.find({ 'rerouteRequest.status': 'pending' })
      .sort({ updatedAt: -1 })
      .populate('departmentId', 'name')
      .populate('userId', 'fullName email')
      .populate('rerouteRequest.requestedBy', 'fullName email')
      .populate('rerouteRequest.fromDepartmentId', 'name')
      .populate('rerouteRequest.proposedDepartmentId', 'name');
    res.json({ success: true, requests: list });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch reroute requests' });
  }
});

router.post('/reroute-requests/:id/approve', async (req, res) => {
  try {
    const { departmentId, note } = req.body || {};
    const comp = await Complaint.findById(req.params.id);
    if (!comp) return res.status(404).json({ success: false, message: 'Complaint not found' });
    if (String(comp?.rerouteRequest?.status || '') !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending reroute request for this complaint' });
    }

    const targetId = departmentId || comp.rerouteRequest?.proposedDepartmentId;
    if (!targetId) return res.status(400).json({ success: false, message: 'Target department required' });
    const dep = await Department.findById(targetId).select('_id name');
    if (!dep) return res.status(404).json({ success: false, message: 'Target department not found' });

    const fromDepartmentId = comp.departmentId || undefined;
    const fromDepartmentName = String(comp.department || '').trim();
    const toDepartmentName = String(dep.name || '').trim();

    comp.rerouteHistory = Array.isArray(comp.rerouteHistory) ? comp.rerouteHistory : [];
    comp.rerouteHistory.push({
      fromDepartmentId,
      toDepartmentId: dep._id,
      decidedBy: req.user._id,
      reason: comp.rerouteRequest?.reason || '',
      at: new Date()
    });

    comp.departmentId = dep._id;
    comp.department = toDepartmentName || comp.department;
    comp.assignedTo = null;
    comp.assignedDate = null;
    comp.dueDate = null;
    comp.status = 'pending';

    const rr = comp.rerouteRequest ? comp.rerouteRequest.toObject() : {};
    comp.rerouteRequest = {
      ...rr,
      status: 'approved',
      proposedDepartmentId: dep._id,
      decidedBy: req.user._id,
      decidedAt: new Date(),
      decisionNote: note || ''
    };

    comp.timeline = comp.timeline || [];
    comp.timeline.push({
      type: 'rerouted',
      message: `Super Admin rerouted from ${fromDepartmentName || 'previous department'} to ${toDepartmentName}`,
      by: req.user._id,
      byRole: 'super-admin',
      at: new Date(),
      meta: { fromDepartmentId, toDepartmentId: dep._id }
    });

    await comp.save();
    audit(req, 'approve-reroute-request', 'complaint', comp._id, { toDepartmentId: dep._id, note: note || undefined });

    try {
      const citizenRecipient = comp.userId?._id || comp.userId;
      if (citizenRecipient) {
        await Notification.create({
          recipient: citizenRecipient,
          recipientModel: 'User',
          title: 'Complaint Rerouted',
          message: `Your complaint ${comp.complaintId} has been rerouted to ${toDepartmentName}.`,
          type: 'info',
          relatedTo: 'complaint',
          relatedId: comp._id
        });
      }
    } catch (e) {}

    try {
      const deptAdminRecipient = rr.requestedBy;
      if (deptAdminRecipient) {
        await Notification.create({
          recipient: deptAdminRecipient,
          recipientModel: 'DepartmentAdmin',
          title: 'Reroute Approved',
          message: `Reroute request for complaint ${comp.complaintId} was approved.`,
          type: 'success',
          relatedTo: 'complaint',
          relatedId: comp._id
        });
      }
    } catch (e) {}

    if (global.io) {
      global.io.emit('complaintUpdate', { complaintId: comp._id, status: comp.status, department: comp.department });
    }

    res.json({ success: true, complaint: { id: comp._id, department: comp.department, departmentId: comp.departmentId } });
  } catch (e) {
    console.error('Approve reroute request error:', e);
    res.status(500).json({ success: false, message: 'Failed to approve reroute request' });
  }
});

router.post('/reroute-requests/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const comp = await Complaint.findById(req.params.id);
    if (!comp) return res.status(404).json({ success: false, message: 'Complaint not found' });
    if (String(comp?.rerouteRequest?.status || '') !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending reroute request for this complaint' });
    }

    const rr = comp.rerouteRequest ? comp.rerouteRequest.toObject() : {};
    comp.rerouteRequest = {
      ...rr,
      status: 'rejected',
      decidedBy: req.user._id,
      decidedAt: new Date(),
      decisionNote: reason || ''
    };

    comp.timeline = comp.timeline || [];
    comp.timeline.push({
      type: 'reroute-rejected',
      message: 'Super Admin rejected reroute request',
      by: req.user._id,
      byRole: 'super-admin',
      at: new Date(),
      meta: { reason: reason || undefined }
    });

    await comp.save();
    audit(req, 'reject-reroute-request', 'complaint', comp._id, { reason: reason || undefined });

    try {
      const deptAdminRecipient = rr.requestedBy;
      if (deptAdminRecipient) {
        await Notification.create({
          recipient: deptAdminRecipient,
          recipientModel: 'DepartmentAdmin',
          title: 'Reroute Rejected',
          message: `Reroute request for complaint ${comp.complaintId} was rejected.`,
          type: 'warning',
          relatedTo: 'complaint',
          relatedId: comp._id
        });
      }
    } catch (e) {}

    res.json({ success: true });
  } catch (e) {
    console.error('Reject reroute request error:', e);
    res.status(500).json({ success: false, message: 'Failed to reject reroute request' });
  }
});

router.post('/complaints/:id/mark-invalid', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const comp = await Complaint.findById(req.params.id);
    if (!comp) return res.status(404).json({ success: false, message: 'Complaint not found' });
    if (String(comp?.rerouteRequest?.status || '') !== 'pending') {
      return res.status(400).json({ success: false, message: 'Complaint is not in reroute review flow' });
    }

    const rr = comp.rerouteRequest ? comp.rerouteRequest.toObject() : {};
    comp.rerouteRequest = {
      ...rr,
      status: 'rejected',
      decidedBy: req.user._id,
      decidedAt: new Date(),
      decisionNote: reason || ''
    };
    comp.status = 'rejected';

    comp.timeline = comp.timeline || [];
    comp.timeline.push({
      type: 'invalid',
      message: 'Super Admin marked complaint invalid',
      by: req.user._id,
      byRole: 'super-admin',
      at: new Date(),
      meta: { reason: reason || undefined }
    });

    await comp.save();
    audit(req, 'mark-invalid', 'complaint', comp._id, { reason: reason || undefined });

    try {
      const citizenRecipient = comp.userId?._id || comp.userId;
      if (citizenRecipient) {
        await Notification.create({
          recipient: citizenRecipient,
          recipientModel: 'User',
          title: 'Complaint Invalid',
          message: `Your complaint ${comp.complaintId} was marked invalid. ${reason ? `Reason: ${reason}` : ''}`.trim(),
          type: 'error',
          relatedTo: 'complaint',
          relatedId: comp._id
        });
      }
    } catch (e) {}

    try {
      const deptAdminRecipient = rr.requestedBy;
      if (deptAdminRecipient) {
        await Notification.create({
          recipient: deptAdminRecipient,
          recipientModel: 'DepartmentAdmin',
          title: 'Complaint Marked Invalid',
          message: `Complaint ${comp.complaintId} was marked invalid by Super Admin.`,
          type: 'warning',
          relatedTo: 'complaint',
          relatedId: comp._id
        });
      }
    } catch (e) {}

    if (global.io) {
      global.io.emit('complaintUpdate', { complaintId: comp._id, status: comp.status, department: comp.department });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Mark invalid complaint error:', e);
    res.status(500).json({ success: false, message: 'Failed to mark complaint invalid' });
  }
});

module.exports = router;
