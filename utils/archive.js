/**
 * Archive Utility
 * Saves dated snapshots of data files to /data/history/.
 * Provides staleness checking to throttle expensive Apify calls.
 */

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '../data/history');

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

/**
 * Archive a data file to /data/history/{basename}_{YYYY-MM-DD}.json
 * Overwrites today's snapshot if called multiple times in a day (last run wins).
 */
function archive(dataFilePath) {
  ensureHistoryDir();
  if (!fs.existsSync(dataFilePath)) return null;
  const today = new Date().toISOString().split('T')[0];
  const basename = path.basename(dataFilePath, '.json');
  const destFile = path.join(HISTORY_DIR, `${basename}_${today}.json`);
  fs.copyFileSync(dataFilePath, destFile);
  return destFile;
}

/**
 * Returns the last `limit` historical snapshots for a module, newest first.
 * moduleName = basename of the data file without .json (e.g. 'price_intelligence')
 */
function getHistory(moduleName, limit = 30) {
  ensureHistoryDir();
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith(moduleName + '_') && f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => {
    const date = f.replace(moduleName + '_', '').replace('.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
      return { date, data };
    } catch {
      return { date, error: true };
    }
  });
}

/**
 * Returns true if the file (or ISO timestamp string) is older than maxAgeHours.
 * Pass a file path to check file mtime, or an ISO string to check a recorded timestamp.
 */
function isStale(filePathOrTimestamp, maxAgeHours) {
  try {
    let mtime;
    if (!filePathOrTimestamp) return true;
    if (filePathOrTimestamp.includes('/') || filePathOrTimestamp.includes('\\')) {
      // File path
      if (!fs.existsSync(filePathOrTimestamp)) return true;
      mtime = fs.statSync(filePathOrTimestamp).mtime;
    } else {
      // ISO timestamp string
      mtime = new Date(filePathOrTimestamp);
    }
    const ageHours = (Date.now() - new Date(mtime).getTime()) / (1000 * 60 * 60);
    return ageHours >= maxAgeHours;
  } catch {
    return true;
  }
}

module.exports = { archive, getHistory, isStale };
