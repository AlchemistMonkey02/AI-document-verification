const mammoth = require("mammoth");

async function parseDoc(filePath) {
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    } catch (error) {
        console.error("Error parsing DOC/DOCX:", error);
        throw new Error("Failed to extract text from document");
    }
}

module.exports = parseDoc;
