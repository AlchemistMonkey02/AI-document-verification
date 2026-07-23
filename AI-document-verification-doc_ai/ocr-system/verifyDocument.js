const fs = require('fs');
const path = require('path');
const parsePDF = require('./services/pdfTextExtractor');
const parseDoc = require('./services/docParser');
const verificationService = require('./services/verificationService');

async function extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
        return await parsePDF(filePath);
    } else if (ext === '.docx' || ext === '.doc') {
        return await parseDoc(filePath);
    } else if (ext === '.txt') {
        return fs.readFileSync(filePath, 'utf-8');
    }
    throw new Error(`Unsupported file format: ${ext}`);
}

async function verifyDocument(filePath, documentType = "AUTO") {
    console.log(`[*] Processing file: ${filePath}`);

    try {
        const textContent = await extractText(filePath);
        if (!textContent || textContent.trim().length === 0) {
            console.log('[!] Error: File is empty or text could not be extracted.');
            return;
        }

        const result = await verificationService.verify(textContent, {}, documentType);

        console.log('\n--- VERIFICATION RESULT ---');
        console.log(JSON.stringify(result, null, 2));
        console.log('---------------------------\n');

        return result;
    } catch (error) {
        console.error(`[!] Verification Error: ${error.message}`);
    }
}

// Run if called from command line
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node verifyDocument.js <path-to-file> [document-type]');
        process.exit(1);
    }
    
    const filePath = args[0];
    const docType = args[1] || "AUTO";

    if (fs.existsSync(filePath)) {
        verifyDocument(filePath, docType);
    } else {
        console.log(`File not found: ${filePath}`);
    }
}

module.exports = verifyDocument;
