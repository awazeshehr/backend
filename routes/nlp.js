const express = require('express');
const { classifyComplaint } = require('../services/complaintClassifierService');
const { analyzeFeedbackSentiment } = require('../services/feedbackSentimentService');
const CategoryDepartmentMapping = require('../models/CategoryDepartmentMapping');

const router = express.Router();

router.post('/classify-complaint', async (req, res) => {
  try {
    const complaintText = req.body?.complaint_text;
    const result = await classifyComplaint(complaintText);
    res.json({
      category: result.category,
      priority: result.priority === 'critical' ? 'Critical' : (result.priority?.charAt(0).toUpperCase() + result.priority?.slice(1)),
      confidence: result.confidence
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to classify complaint' });
  }
});

router.post('/analyze-feedback', async (req, res) => {
  try {
    const feedbackText = req.body?.feedback_text;
    const result = await analyzeFeedbackSentiment(feedbackText);
    res.json({
      sentiment: result.sentiment,
      compound_score: result.compound_score
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to analyze feedback' });
  }
});

router.post('/recommend-routing', async (req, res) => {
  try {
    const complaintText = req.body?.complaint_text;
    const result = await classifyComplaint(complaintText);
    const categoryKey = String(result.category || '').trim().toLowerCase();
    const mapping = await CategoryDepartmentMapping.findOne({ $or: [{ categoryKey }, { categoryName: String(result.category || '').trim() }] })
      .populate('departmentId', 'name');
    res.json({
      category: result.category,
      priority: result.priority,
      confidence: result.confidence,
      recommendedDepartment: mapping?.departmentId?._id ? { _id: mapping.departmentId._id, name: mapping.departmentId.name } : null
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to recommend routing' });
  }
});

module.exports = router;
