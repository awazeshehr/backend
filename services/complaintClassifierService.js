const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CATEGORY_PRIORITY = Object.freeze({
  'Gas Leak': { priority: 'critical', color: 'red' },
  'Gas Supply Issue': { priority: 'high', color: 'orange' },
  'Pipeline Damage': { priority: 'high', color: 'orange' },
  'Meter Issue': { priority: 'medium', color: 'yellow' },
  'Low Gas Pressure': { priority: 'medium', color: 'yellow' },
  'Billing Complaint': { priority: 'low', color: 'green' }
});

const PRIORITY_COLOR_BY_LEVEL = Object.freeze({
  low: 'green',
  medium: 'yellow',
  high: 'orange',
  critical: 'red'
});

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function priorityForCategory(category) {
  const entry = CATEGORY_PRIORITY[String(category || '').trim()];
  if (!entry) return { priority: 'medium', priority_color: 'yellow' };
  return { priority: entry.priority, priority_color: entry.color };
}

function adjustPriority(category, basePriority, confidence, source) {
  if (source === 'empty') return 'low';
  if (String(category || '').trim() === 'Gas Leak') return 'critical';
  if (typeof confidence === 'number') {
    if (confidence < 0.35) return 'low';
    if (confidence < 0.6) return 'medium';
  }
  return basePriority;
}

function heuristicClassify(text) {
  const t = normalizeWhitespace(text).toLowerCase();
  if (!t) return { category: 'Gas Supply Issue', confidence: 0.4 };

  const patterns = [
    { category: 'Gas Leak', confidence: 0.92, any: ['gas leak', 'leakage', 'smell gas', 'gas smell', 'hissing', 'pipeline burst', 'pipe burst', 'گيس لیک', 'گیس لیک', 'گیس کی بو', 'بو آرہی', 'بو آ رہی', 'آگ'] },
    { category: 'Pipeline Damage', confidence: 0.86, any: ['pipeline damage', 'pipe damaged', 'pipe broken', 'pipeline broken', 'line damaged', 'pipeline burst', 'pipe burst', 'پائپ ٹوٹ', 'پائپ خراب', 'پائپ لیک'] },
    { category: 'Low Gas Pressure', confidence: 0.82, any: ['low pressure', 'gas pressure low', 'flame low', 'weak flame', 'کم پریشر', 'گیس کم', 'آگ کم'] },
    { category: 'Gas Supply Issue', confidence: 0.78, any: ['no gas', 'gas not available', 'gas supply', 'supply issue', 'gas off', 'gas outage', 'گیس نہیں', 'گیس بند', 'پہنچ نہیں رہی'] },
    { category: 'Meter Issue', confidence: 0.75, any: ['meter', 'meter issue', 'meter not working', 'meter broken', 'reading issue', 'گیس میٹر', 'میٹر خراب'] },
    { category: 'Billing Complaint', confidence: 0.72, any: ['bill', 'billing', 'overcharged', 'wrong bill', 'invoice', 'charges', 'bill too high', 'بل', 'بل زیادہ', 'غلط بل'] }
  ];

  for (const p of patterns) {
    if (p.any.some((k) => t.includes(k))) return { category: p.category, confidence: p.confidence };
  }
  return { category: 'Gas Supply Issue', confidence: 0.45 };
}

function runPythonBertClassifier(text) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '../scripts/classify_complaint_bert.py');
    if (!fs.existsSync(scriptPath)) {
      reject(new Error('BERT classifier script not found'));
      return;
    }

    const pythonProcess = spawn('python', [scriptPath]);
    let result = '';
    let errorOutput = '';

    pythonProcess.stdin.write(JSON.stringify({ complaint_text: text || '' }));
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `BERT classifier exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(result);
        if (!parsed || !parsed.category || typeof parsed.confidence !== 'number') {
          reject(new Error('Invalid BERT classifier output'));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse BERT output: ${e?.message || e}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function classifyComplaint(textRaw) {
  const complaintText = normalizeWhitespace(textRaw);
  if (!complaintText) {
    const base = priorityForCategory('Gas Supply Issue');
    const priority = adjustPriority('Gas Supply Issue', base.priority, 0, 'empty');
    const priority_color = PRIORITY_COLOR_BY_LEVEL[priority] || base.priority_color;
    return {
      category: 'Gas Supply Issue',
      priority,
      confidence: 0,
      priority_color,
      source: 'empty'
    };
  }

  try {
    const result = await runPythonBertClassifier(complaintText);
    const base = priorityForCategory(result.category);
    const priority = adjustPriority(result.category, base.priority, result.confidence, 'bert-base-uncased');
    const priority_color = PRIORITY_COLOR_BY_LEVEL[priority] || base.priority_color;
    return {
      category: result.category,
      priority,
      confidence: result.confidence,
      priority_color,
      source: 'bert-base-uncased'
    };
  } catch (e) {
    const fallback = heuristicClassify(complaintText);
    const base = priorityForCategory(fallback.category);
    const priority = adjustPriority(fallback.category, base.priority, fallback.confidence, 'heuristic');
    const priority_color = PRIORITY_COLOR_BY_LEVEL[priority] || base.priority_color;
    return {
      category: fallback.category,
      priority,
      confidence: fallback.confidence,
      priority_color,
      source: 'heuristic'
    };
  }
}

module.exports = {
  classifyComplaint,
  priorityForCategory
};
