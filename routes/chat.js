const express = require('express');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const router = express.Router();

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

// Get direct messages with a specific user
router.get('/direct/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const currentUserId = req.user._id; // or req.user.userId depending on auth middleware

    const messages = await Message.find({
      $or: [
        { senderId: currentUserId, recipientId: otherUserId },
        { senderId: otherUserId, recipientId: currentUserId }
      ]
    })
      .sort({ createdAt: 1 })
      .limit(500);
      
    res.json({ success: true, messages });
  } catch (e) {
    console.error('Error fetching direct messages:', e);
    res.status(500).json({ success: false, message: 'Failed to fetch direct messages' });
  }
});

// Get messages for a complaint
router.get('/:complaintId', auth, async (req, res) => {
  try {
    const { complaintId } = req.params;
    const messages = await Message.find({ complaintId })
      .sort({ createdAt: 1 })
      .limit(500);
    res.json({ success: true, messages });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch messages' });
  }
});

module.exports = router;



