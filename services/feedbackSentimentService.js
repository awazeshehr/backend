const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function normalizeText(text) {
  return String(text || '').trim();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function analyzeSentimentLocal(textRaw) {
  const text = String(textRaw || '').trim();
  if (!text) return { sentiment: 'neutral', compound_score: 0, source: 'local-empty' };

  const lower = text.toLowerCase();
  const romanUrduLexicon = {
    bura: -2.0, buri: -2.0, bure: -2.0,
    ghatiya: -3.0,
    bakwas: -3.0,
    fazool: -2.0,
    kharab: -2.0,
    ganda: -2.5, gandi: -2.5,
    sharam: -2.0,
    afsos: -1.5,
    pareshan: -2.0,
    zillat: -3.0,
    bekar: -2.0,
    dukh: -2.0,
    takleef: -2.0,
    lanat: -3.5,
    jhoot: -2.0, jhoota: -2.0,
    badtameez: -2.5,
    "na-ahli": -2.0,
    sust: -1.5,
    mushkil: -1.5,
    masla: -1.5, masle: -1.5,
    shikayat: -1.0,
    gandagi: -2.5,
    badboo: -2.5,
    toot: -1.5, toota: -1.5,
    khatam: -1.0,
    nakam: -2.0,
    acha: 2.0, achi: 2.0, ache: 2.0,
    behtareen: 3.0,
    zabardast: 3.0,
    shukriya: 2.0,
    khush: 2.0,
    pasand: 2.0,
    theek: 1.5,
    behtar: 1.5,
    badiya: 2.0,
    zindabad: 2.5,
    madad: 1.5,
    hal: 1.0,
    safai: 1.5,
    saaf: 1.5,
    meharbani: 2.0,
    leakage: -2.0, leaking: -2.0,
    broken: -2.0, broke: -2.0,
    damaged: -2.0,
    garbage: -2.0, trash: -2.0,
    smell: -2.0, stink: -2.0,
    dirty: -2.0, filthy: -2.0,
    polluted: -2.5,
    overflow: -1.5, overflowing: -1.5,
    blocked: -2.0, blocking: -2.0,
    shortage: -2.0,
    pothole: -2.0, potholes: -2.0,
    unsafe: -2.0, dangerous: -2.5,
    risk: -1.5,
    sparking: -1.5, sparks: -1.5
  };

  const strongNegativeKeywords = [
    'angry', 'furious', 'upset', 'disappointed', 'frustrated',
    'worst', 'terrible', 'horrible', 'pathetic', 'useless',
    'ghatiya', 'bakwas', 'lanat', 'zillat', 'sharam',
    'not working', 'not available', 'no water', 'no electricity', 'no power',
    'not clean', 'not collected', 'very bad',
    'pani nahi', 'bijli nahi', 'gas nahi', 'nahi aa raha', 'nahi a raha',
    'masla hai', 'kharab hai'
  ];

  let score = 0;

  const phraseWeights = [
    { p: 'not working', w: -2.5 },
    { p: 'not available', w: -2.0 },
    { p: 'no water', w: -2.5 },
    { p: 'no electricity', w: -2.5 },
    { p: 'no power', w: -2.0 },
    { p: 'very bad', w: -2.5 },
    { p: 'behtareen', w: 3.0 },
    { p: 'zabardast', w: 3.0 }
  ];
  for (const { p, w } of phraseWeights) {
    if (lower.includes(p)) score += w;
  }

  const tokens = lower.match(/[a-z]+(?:-[a-z]+)?/g) || [];
  for (const tok of tokens) {
    if (Object.prototype.hasOwnProperty.call(romanUrduLexicon, tok)) score += romanUrduLexicon[tok];
  }

  let compound = Math.tanh(score / 4);
  const isStrongNegative = strongNegativeKeywords.some(k => lower.includes(k));
  if (isStrongNegative && compound >= -0.05) compound = -0.1;

  compound = clamp(compound, -1, 1);
  const sentiment = compound >= 0.05 ? 'positive' : compound <= -0.05 ? 'negative' : 'neutral';
  return { sentiment, compound_score: compound, source: 'local' };
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
    return analyzeSentimentLocal(text);
  }
}

module.exports = {
  analyzeFeedbackSentiment
};
