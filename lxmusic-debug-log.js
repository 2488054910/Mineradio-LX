// ============================================================
// lxmusic-debug-log.js — 免费音源调试日志
// 记录每次操作到 D:\Mineradio\lxmusic-debug.log
// ============================================================

var fs = require('fs');
var path = require('path');

var LOG_PATH = path.join('D:\\Mineradio', 'lxmusic-debug.log');
var MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function _timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
}

function _rotateIfNeeded() {
  try {
    var stat = fs.statSync(LOG_PATH);
    if (stat.size > MAX_LOG_SIZE) {
      var backup = LOG_PATH.replace('.log', '-' + Date.now() + '.log');
      fs.renameSync(LOG_PATH, backup);
    }
  } catch (_) {}
}

/**
 * 写一条日志到文件
 * @param {string} category - 日志分类，如 'TRIGGER', 'RESOLVE', 'PLAYBACK', 'CONFIG', 'ERROR'
 * @param {string} message - 日志内容
 * @param {Object} [data] - 附加数据（可选）
 */
function logLxMusic(category, message, data) {
  try {
    _rotateIfNeeded();
    var line = '[' + _timestamp() + '] [' + category + '] ' + message;
    if (data !== undefined) {
      line += ' | ' + JSON.stringify(data);
    }
    line += '\n';
    fs.appendFileSync(LOG_PATH, line, 'utf8');
    // 同时输出到控制台
    console.log('[LxDebug][' + category + '] ' + message);
  } catch (e) {
    console.error('[LxDebug] 写日志失败:', e.message);
  }
}

/**
 * 清空日志文件
 */
function clearLog() {
  try {
    fs.writeFileSync(LOG_PATH, '--- 日志清空 ' + _timestamp() + ' ---\n', 'utf8');
  } catch (_) {}
}

module.exports = { logLxMusic: logLxMusic, clearLog: clearLog };
