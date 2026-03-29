const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const timestamp = () => new Date().toISOString();

const writeToFile = (level, message) => {
  const line = `[${timestamp()}] [${level}] ${message}\n`;
  const file = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFile(file, line, () => {});
};

const logger = {
  info:  (msg, ...args) => { console.log(`\x1b[36m[INFO]\x1b[0m  ${msg}`, ...args);  writeToFile('INFO',  `${msg} ${args.join(' ')}`); },
  warn:  (msg, ...args) => { console.warn(`\x1b[33m[WARN]\x1b[0m  ${msg}`, ...args); writeToFile('WARN',  `${msg} ${args.join(' ')}`); },
  error: (msg, ...args) => { console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`, ...args); writeToFile('ERROR', `${msg} ${args.join(' ')}`); },
  debug: (msg, ...args) => { if (process.env.NODE_ENV === 'development') console.log(`\x1b[35m[DEBUG]\x1b[0m ${msg}`, ...args); },
};

module.exports = logger;
