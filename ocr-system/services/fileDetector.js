const path = require("path");

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext;
}

module.exports = detectFileType;
