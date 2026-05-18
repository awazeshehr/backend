console.log('Starting server.js execution...');
const express = require('express');
console.log('express loaded');
const cors = require('cors');
console.log('cors loaded');
const dotenv = require('dotenv');
console.log('dotenv loaded');
const path = require('path');
console.log('path loaded');
const connectDB = require('./config/database');
console.log('connectDB loaded');
const mongoose = require('mongoose');
console.log('mongoose loaded');

// Load env vars
dotenv.config();
console.log('dotenv configured');

// Connect to database
console.log('Calling connectDB...');
connectDB();
console.log('connectDB called.');

const app = express();
const http = require('http');
const { Server } = require('socket.io');

// Middleware
app.use(cors());
app.use(express.json());
app.use(require('./middleware/correlation'));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));
// Add these lines after existing routes
app.use('/api/profile', require('./routes/profile'));
app.use('/api/performance', require('./routes/performance'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/superadmin', require('./routes/superadmin'));
app.use('/', require('./routes/nlp'));
// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Awaz e Shehr Server is running!' });
});

// Database health
app.get('/api/db/health', (req, res) => {
  const state = mongoose.connection.readyState;
  res.json({ connected: state === 1, state });
});

const PORT = process.env.PORT || 5100;

const server = http.createServer(app);

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Socket.IO auth using query token (Bearer)
const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const Complaint = require('./models/Complaint');
const FieldOfficer = require('./models/FieldOfficer');
const MESSAGE_TEMPLATES = {
  'field-officer': {
    arrived: 'I have arrived at the location.',
    in_progress: 'Work is in progress.',
    requires_materials: 'Issue requires additional materials.',
    resolved_verify: 'Issue resolved. Please verify.',
    custom_message: ''
  },
  citizen: {
    still_not_resolved: 'Issue still not resolved.',
    additional_info: 'Additional information provided.',
    check_area: 'Please check this area.',
    thank_you: 'Thank you.',
    custom_message: ''
  }
};

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Unauthorized'));
    const raw = token.replace('Bearer ', '');
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);
    socket.user = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  try {
    const userRoom = `user:${socket.user.userId}`;
    socket.join(userRoom);
  } catch (e) {}
  // Join complaint room
  socket.on('joinComplaint', (complaintId) => {
    if (!complaintId) return;
    socket.join(`complaint:${complaintId}`);
  });

  socket.on('sendMessage', async ({ complaintId, templateKey, notes }) => {
    try {
      if (!complaintId) return;
      const effectiveTemplate = templateKey && String(templateKey).trim() ? String(templateKey).trim() : 'custom_message';
      const complaint = await Complaint.findById(complaintId).select('userId assignedTo category assignedDate status');
      if (!complaint) return;
      const s = String(complaint.status || '').toLowerCase();
      if (s === 'completed') {
        socket.emit('errorMessage', 'Chat closed');
        return;
      }
      const role = socket.user.role;
      const allowed = MESSAGE_TEMPLATES[role];
      if (!allowed || allowed[effectiveTemplate] === undefined) return;
      if (role === 'citizen' && String(complaint.userId) !== String(socket.user.userId)) return;
      if (role === 'field-officer' && String(complaint.assignedTo) !== String(socket.user.userId)) {
        if (!complaint.assignedTo) {
          const officer = await FieldOfficer.findById(socket.user.userId).select('department');
          const deptName = (officer?.department || '').toLowerCase();
          const categories = (() => {
            if (!deptName) return ['other'];
            if (deptName.includes('water') || deptName.includes('sewer')) return ['water'];
            if (deptName.includes('electric')) return ['electricity'];
            if (deptName.includes('sanitation') || deptName.includes('clean')) return ['sanitation'];
            if (deptName.includes('road')) return ['roads'];
            if (deptName.includes('waste') || deptName.includes('solid')) return ['waste'];
            return ['other'];
          })();
          if (categories.includes(complaint.category)) {
            // Do not auto-assign on chat
          } else {
            return;
          }
        } else {
          return;
        }
      }
      const base = allowed[effectiveTemplate];
      const extra = notes && String(notes).trim() ? ` ${String(notes).trim()}` : '';
      const finalText = `${base}${extra}`.trim();
      const message = await Message.create({
        complaintId,
        senderId: socket.user.userId,
        senderRole: role,
        text: finalText,
        templateKey: effectiveTemplate,
        notes: notes && String(notes).trim() ? String(notes).trim() : undefined
      });
      io.to(`complaint:${complaintId}`).emit('newMessage', {
        _id: message._id,
        complaintId: message.complaintId,
        senderId: message.senderId,
        senderRole: message.senderRole,
        text: message.text,
        templateKey: message.templateKey,
        notes: message.notes,
        createdAt: message.createdAt
      });

      // Mark delivered for sender's message and notify room
      try {
        message.status = 'delivered';
        message.deliveredAt = new Date();
        await message.save();
        io.to(`complaint:${complaintId}`).emit('messageStatusUpdate', {
          ids: [message._id],
          status: 'delivered',
          deliveredAt: message.deliveredAt
        });
      } catch (e) {}

      const Notification = require('./models/Notification');
      try {
        let recipientId = null;
        if (role === 'field-officer') recipientId = complaint.userId;
        if (role === 'citizen' && complaint.assignedTo) recipientId = complaint.assignedTo;
        if (recipientId) {
          await Notification.create({
            userId: recipientId,
            recipient: recipientId,
            recipientModel: role === 'field-officer' ? 'User' : 'FieldOfficer',
            title: 'New Complaint Message',
            message: `New message on complaint ${complaintId}.`,
            type: 'info',
            relatedTo: 'complaint',
            relatedId: complaintId
          });
          io.to(`user:${recipientId}`).emit('notificationUpdate', { userId: recipientId });
          io.to(`user:${socket.user.userId}`).emit('notificationUpdate', { userId: socket.user.userId });
        }
      } catch (e) {}
    } catch (e) {
      socket.emit('errorMessage', 'Failed to send message');
    }
  });

  // Mark complaint messages as seen for current user
  socket.on('markComplaintMessagesSeen', async ({ complaintId }) => {
    try {
      if (!complaintId) return;
      const updated = await Message.updateMany(
        { complaintId, senderId: { $ne: socket.user.userId }, status: { $ne: 'seen' } },
        { $set: { status: 'seen', seenAt: new Date() } }
      );
      const ids = await Message.find({ complaintId, senderId: { $ne: socket.user.userId }, status: 'seen' }).select('_id');
      const list = ids.map(i => i._id);
      io.to(`complaint:${complaintId}`).emit('messageStatusUpdate', { ids: list, status: 'seen' });
    } catch (e) {}
  });

  // Join direct chat room
  socket.on('joinDirectChat', (otherUserId) => {
    if (!otherUserId) return;
    const ids = [socket.user.userId, otherUserId].sort();
    const roomId = `direct:${ids[0]}_${ids[1]}`;
    socket.join(roomId);
  });

  // Send direct message
  socket.on('sendDirectMessage', async ({ recipientId, text }) => {
    try {
      if (!recipientId || !text) return;
      const senderRole = socket.user.role;
      const DepartmentAdmin = require('./models/DepartmentAdmin');
      const FieldOfficer = require('./models/FieldOfficer');

      let recipientRole = null;
      let senderDepartment = null;
      let recipientDepartment = null;

      const [recipientAdmin, recipientOfficer] = await Promise.all([
        DepartmentAdmin.findById(recipientId).select('department').lean(),
        FieldOfficer.findById(recipientId).select('department').lean()
      ]);

      if (recipientAdmin) {
        recipientRole = 'dept-admin';
        recipientDepartment = recipientAdmin.department || null;
      } else if (recipientOfficer) {
        recipientRole = 'field-officer';
        recipientDepartment = recipientOfficer.department || null;
      }

      if (senderRole === 'dept-admin') {
        const senderAdmin = await DepartmentAdmin.findById(socket.user.userId).select('department').lean();
        senderDepartment = senderAdmin?.department || null;
      } else if (senderRole === 'field-officer') {
        const senderOfficer = await FieldOfficer.findById(socket.user.userId).select('department').lean();
        senderDepartment = senderOfficer?.department || null;
      }

      const isDeptAdminToOfficer =
        (senderRole === 'dept-admin' && recipientRole === 'field-officer') ||
        (senderRole === 'field-officer' && recipientRole === 'dept-admin');

      if (isDeptAdminToOfficer) {
        const sameDepartment =
          String(senderDepartment || '').trim().toLowerCase() === String(recipientDepartment || '').trim().toLowerCase();
        if (!sameDepartment) {
          return socket.emit('errorMessage', 'Cannot message outside your department');
        }
      }
      
      const message = await Message.create({
        recipientId,
        senderId: socket.user.userId,
        senderRole: socket.user.role,
        text: text,
        templateKey: 'custom_message'
      });
      
      const ids = [socket.user.userId, recipientId].sort();
      const roomId = `direct:${ids[0]}_${ids[1]}`;
      
      io.to(roomId).emit('newDirectMessage', {
        _id: message._id,
        recipientId: message.recipientId,
        senderId: message.senderId,
        senderRole: message.senderRole,
        text: message.text,
        createdAt: message.createdAt
      });

      message.status = 'delivered';
      message.deliveredAt = new Date();
      await message.save();
      io.to(roomId).emit('messageStatusUpdate', { ids: [message._id], status: 'delivered', deliveredAt: message.deliveredAt });

      const Notification = require('./models/Notification');
      try {
        await Notification.create({
          userId: recipientId,
          title: 'New Message',
          message: `You have a new message from ${socket.user.role}.`,
          type: 'info',
          relatedTo: 'message',
          relatedId: message._id
        });
      } catch (e) {}
      io.to(`user:${recipientId}`).emit('notificationUpdate', { userId: recipientId });
      io.to(`user:${socket.user.userId}`).emit('notificationUpdate', { userId: socket.user.userId });
    } catch (e) {
      console.error('Send direct message error:', e);
      socket.emit('errorMessage', 'Failed to send message');
    }
  });

  socket.on('markDirectMessagesSeen', async ({ otherUserId }) => {
    try {
      if (!otherUserId) return;
      const Message = require('./models/Message');
      const updated = await Message.updateMany(
        { recipientId: socket.user.userId, senderId: otherUserId, status: { $ne: 'seen' } },
        { $set: { status: 'seen', seenAt: new Date() } }
      );
      const ids = await Message.find({ recipientId: socket.user.userId, senderId: otherUserId, status: 'seen' }).select('_id');
      const list = ids.map(i => i._id);
      const roomId = `direct:${[socket.user.userId, otherUserId].sort()[0]}_${[socket.user.userId, otherUserId].sort()[1]}`;
      io.to(roomId).emit('messageStatusUpdate', { ids: list, status: 'seen' });
    } catch (e) {}
  });
});

// Export io instance for use in routes
global.io = io;

console.log('Calling server.listen...');
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
  try {
    const SystemPolicy = require('./models/SystemPolicy');
    const Notification = require('./models/Notification');
    const Complaint = require('./models/Complaint');
    // Simple scheduled policy enforcement: reminders and escalations
    const runPolicyTasks = async () => {
      try {
        const policy = await SystemPolicy.findOne({});
        if (!policy) return;
        const now = Date.now();
        const reminderMs = (policy.reminderHoursPending || 24) * 60 * 60 * 1000;
        const escalateMs = (policy.escalateAfterHours || 96) * 60 * 60 * 1000;
        const pendingComplaints = await Complaint.find({ status: 'pending' }).select('_id userId createdAt complaintId dueDate');
        for (const c of pendingComplaints) {
          const pastReminder = now - c.createdAt.getTime() > reminderMs;
          const pastDue = c.dueDate && now > new Date(c.dueDate).getTime();
          if (pastReminder || pastDue) {
            await Notification.create({
              userId: c.userId,
              recipient: c.userId,
              recipientModel: 'User',
              title: 'Reminder: Complaint Pending',
              message: `Your complaint ${c.complaintId} is pending${pastDue ? ' and past due' : ''}.`,
              type: 'info',
              relatedTo: 'complaint',
              relatedId: c._id
            });
          }
        }
        // Escalations
        const unresolved = await Complaint.find({ status: { $ne: 'resolved' } }).select('_id createdAt complaintId escalated dueDate');
        for (const c of unresolved) {
          const pastEscalate = now - c.createdAt.getTime() > escalateMs;
          const pastDue = c.dueDate && now > new Date(c.dueDate).getTime();
          if (!c.escalated && (pastEscalate || pastDue)) {
            c.escalated = true;
            c.escalatedAt = new Date();
            c.timeline = c.timeline || [];
            c.timeline.push({ type: 'escalated', message: 'Auto-escalated per policy', byRole: 'system', at: new Date() });
            await c.save();
          }
        }
      } catch (e) {
        console.error('Policy task error:', e);
      }
    };
    // Run every 15 minutes
    setInterval(runPolicyTasks, 15 * 60 * 1000);
    // Initial run after startup grace
    setTimeout(runPolicyTasks, 60 * 1000);
  } catch (e) {}
});
