const FieldOfficer = require('../models/FieldOfficer');
const Department = require('../models/Department');
const RoutingPolicy = require('../models/RoutingPolicy');
const CategoryDepartmentMapping = require('../models/CategoryDepartmentMapping');
const Complaint = require('../models/Complaint');

module.exports = {
  selectDepartment: async (complaint) => {
    const category = String(complaint?.category || '').trim();
    const areaType = String(complaint?.location?.areaType || 'Urban');
    const sector = String(complaint?.location?.sector || '').trim();
    const ruralJurisdiction = String(complaint?.location?.ruralJurisdiction || '').trim();
    const priority = String(complaint?.priority || '').trim().toLowerCase();
    const text = String(complaint?.description || '').trim();
    const categoryKey = category.toLowerCase();

    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const day = now.getDay();

    const matchesKeyword = (keywords, input) => {
      if (!Array.isArray(keywords) || keywords.length === 0) return true;
      const hay = String(input || '').toLowerCase();
      return keywords.some(k => hay.includes(String(k || '').toLowerCase()));
    };

    const withinTimeWindow = (tw) => {
      if (!tw) return true;
      const days = Array.isArray(tw.daysOfWeek) ? tw.daysOfWeek : [];
      if (days.length > 0 && !days.includes(day)) return false;
      const start = typeof tw.startMinutes === 'number' ? tw.startMinutes : null;
      const end = typeof tw.endMinutes === 'number' ? tw.endMinutes : null;
      if (start == null || end == null) return true;
      if (start <= end) return minutesNow >= start && minutesNow <= end;
      return minutesNow >= start || minutesNow <= end;
    };

    const policies = await RoutingPolicy.find({
      enabled: true,
      'match.categoryKey': categoryKey
    })
      .sort({ priority: 1, updatedAt: -1 })
      .populate('action.departmentId', 'name areaTypes sectors ruralJurisdictions isActive servicesOffered');

    const openCountForDepartment = async (departmentId) => {
      if (!departmentId) return 0;
      return Complaint.countDocuments({
        departmentId,
        status: { $in: ['pending', 'in-progress'] }
      });
    };

    const depCovers = (dep) => {
      if (!dep || dep.isActive === false) return false;
      const types = Array.isArray(dep.areaTypes) ? dep.areaTypes : [];
      if (!types.includes(areaType)) return false;
      if (areaType === 'Urban') {
        if (!sector) return true;
        return Array.isArray(dep.sectors) && dep.sectors.some(s => String(s || '').trim().toLowerCase() === sector.toLowerCase());
      }
      if (!ruralJurisdiction) return true;
      return Array.isArray(dep.ruralJurisdictions) && dep.ruralJurisdictions.some(r => String(r || '').trim().toLowerCase() === ruralJurisdiction.toLowerCase());
    };

    for (const p of policies) {
      const matchArea = String(p?.match?.areaType || 'Any');
      if (matchArea !== 'Any' && matchArea !== areaType) continue;
      if (areaType === 'Urban') {
        const ps = String(p?.match?.sector || '').trim();
        if (ps && ps.toLowerCase() !== sector.toLowerCase()) continue;
      } else {
        const pr = String(p?.match?.ruralJurisdiction || '').trim();
        if (pr && pr.toLowerCase() !== ruralJurisdiction.toLowerCase()) continue;
      }

      const allowed = Array.isArray(p?.conditions?.allowedPriorities) ? p.conditions.allowedPriorities : [];
      if (allowed.length > 0 && priority && !allowed.includes(priority)) continue;
      if (!matchesKeyword(p?.conditions?.keywords, text)) continue;
      if (!withinTimeWindow(p?.conditions?.timeWindow)) continue;

      const actionType = String(p?.action?.type || 'route');
      const dep = p?.action?.departmentId || null;

      if (dep && !depCovers(dep)) continue;
      const maxOpen = typeof p?.conditions?.maxOpenComplaints === 'number' ? p.conditions.maxOpenComplaints : null;
      if (dep && maxOpen != null) {
        const openCount = await openCountForDepartment(dep._id);
        if (openCount > maxOpen) continue;
      }

      if (dep?.name) {
        return { departmentName: dep.name, departmentId: dep._id, policy: p, actionType };
      }
      return { departmentName: null, departmentId: null, policy: p, actionType };
    }

    // Try to find a department directly covering this area/category
    try {
      const mapping = await CategoryDepartmentMapping.findOne({ $or: [{ categoryKey }, { categoryName: String(category || '').trim() }] }).populate('departmentId', 'name');
      if (mapping?.departmentId?.name) return { departmentName: mapping.departmentId.name, departmentId: mapping.departmentId._id, policy: null, actionType: 'route' };
    } catch (e) {
      console.error('Error finding department directly:', e);
    }

    try {
      const dept = await Department.findOne({ isActive: true }).sort({ createdAt: 1 }).select('name');
      if (dept?.name) return { departmentName: dept.name, departmentId: dept._id, policy: null, actionType: 'route' };
    } catch (e) {}

    return { departmentName: 'General Services', departmentId: null, policy: null, actionType: 'route' };
  },

  selectOfficer: async (departmentName) => {
    const any = await FieldOfficer.findOne({ department: departmentName, isActive: true }).lean();
    return any || null;
  },

  routeComplaint: async (complaint) => {
    try {
      const decision = await module.exports.selectDepartment(complaint);
      const DepartmentName = decision?.departmentName || 'General Services';
      const actionType = String(decision?.actionType || 'route');
      const officer = actionType === 'route' ? await module.exports.selectOfficer(DepartmentName) : null;
      let deptDoc = null;
      try {
        deptDoc = await Department.findOne({ name: new RegExp(`^${String(DepartmentName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id name');
      } catch (e) {}
      if (decision?.policy?._id) {
        complaint.routingDecision = {
          policyId: decision.policy._id,
          actionType,
          policyName: decision.policy.name
        };
      } else if (complaint.routingDecision) {
        complaint.routingDecision = undefined;
      }
      if (officer) {
        complaint.assignedTo = officer._id;
        complaint.department = DepartmentName;
        if (deptDoc?._id) complaint.departmentId = deptDoc._id;
        if (!complaint.assignedDate) complaint.assignedDate = new Date();
        await complaint.save();
        return { assigned: true, officer };
      }
      // No officer found: set department and leave unassigned
      complaint.department = DepartmentName;
      if (deptDoc?._id) complaint.departmentId = deptDoc._id;
      await complaint.save();
      return { assigned: false };
    } catch (e) {
      console.error('Routing error:', e);
      return { assigned: false, error: e };
    }
  }
};
