const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function normalizeText(text) {
  return String(text || '').trim();
}

function runVaderFeedback(text) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '../scripts/analyze_sentiment.py');
    if (!fs.existsSync(scriptPath)) {
      reject(new Error('Feedback sentiment script not found'));
      return;
    }

    const pythonProcess = spawn('python', [scriptPath]);
    let result = '';
    let errorOutput = '';

    pythonProcess.stdin.write(text || '');
    pythonProcess.stdin.end();

    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `Feedback sentiment exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(result);
        const label = String(parsed?.label || '').toLowerCase();
        const score = typeof parsed?.score === 'number' ? parsed.score : 0;
        if (!label) {
          reject(new Error('Invalid feedback sentiment output'));
          return;
        }
        resolve({ sentiment: label, compound_score: score });
      } catch (e) {
        reject(new Error(`Failed to parse feedback sentiment output: ${e?.message || e}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function analyzeFeedbackSentiment(textRaw) {
  const text = normalizeText(textRaw);
  if (!text) return { sentiment: 'neutral', compound_score: 0, source: 'empty' };

  try {
    const res = await runVaderFeedback(text);
    return { ...res, source: 'vader' };
  } catch (e) {
    return { sentiment: 'neutral', compound_score: 0, source: 'fallback' };
  }
}

module.exports = {
  analyzeFeedbackSentiment
};

