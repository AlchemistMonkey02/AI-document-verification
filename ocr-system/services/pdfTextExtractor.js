const pdf = require("pdf-parse");
const fs = require("fs");

async function parsePDF(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        console.error("Error parsing PDF:", error);
        throw new Error("Failed to extract text from PDF");
    }
}

module.exports = parsePDF;
