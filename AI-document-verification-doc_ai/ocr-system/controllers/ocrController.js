const detectFileType = require("../services/fileDetector");
const parseDoc = require("../services/docParser");
const parsePDF = require("../services/pdfTextExtractor");
const pdfToImages = require("../services/pdfToImages");
const preprocessImage = require("../services/imagePreprocessor");
const runOCR = require("../services/ocrEngine");
const buildJSON = require("../services/jsonBuilder");
const fs = require("fs");

async function ocrController(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    const ext = detectFileType(filePath);
    let text = "";

    try {
        if (ext === ".pdf") {
            // Try text extraction first
            text = await parsePDF(filePath);

            // If text extraction yields little result (scanned PDF), convert to images and OCR
            if (!text || text.trim().length < 10) {
                console.log("PDF seems to be scanned. converting to images...");
                const imagePath = await pdfToImages(filePath);
                // Note: For multi-page PDFs, pdfToImages returns the path to the first page.
                // A full solution would loop through all generated images.
                // For this demo, we handle the first page.

                const cleanImage = await preprocessImage(imagePath);
                text = await runOCR(cleanImage);
            }
        } else if ([".jpg", ".jpeg", ".png"].includes(ext)) {
            const cleanImage = await preprocessImage(filePath);
            text = await runOCR(cleanImage);
        } else if ([".doc", ".docx"].includes(ext)) {
            text = await parseDoc(filePath);
        } else {
            return res.status(400).json({ error: "Unsupported file type" });
        }

        const compareText = require("../services/textComparator");

        const json = buildJSON(text);

        // Add comparison score if user_input is provided
        if (req.body.user_input) {
            const comparison = compareText(text, req.body.user_input);
            json.comparison = comparison;
        }

        // Cleanup - optional: delete uploaded file and temp images
        // fs.unlinkSync(filePath); 

        res.json(json);

    } catch (error) {
        console.error("OCR Controller Error:", error);
        res.status(500).json({ error: "Processing failed", details: error.message });
    }
}


async function verifyDocument(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document uploaded" });
        }

        // Handle Input: accept 'inputText' (standard) or 'user_input' (legacy)
        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;

        if (typeof rawInput === 'string') {
            try {
                userInput = JSON.parse(rawInput);
            } catch (e) {
                return res.status(400).json({
                    error: "Invalid JSON in inputText/user_input",
                    details: e.message,
                    received: rawInput
                });
            }
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const documentType = req.body.documentType || req.body.document_type;
        if (!documentType) {
            return res.status(400).json({ error: "Missing required parameter: documentType" });
        }

        const filePath = req.file.path;
        const ext = detectFileType(filePath);
        let text = "";

        // Re-use OCR logic
        if (ext === ".pdf") {
            text = await parsePDF(filePath);
            if (!text || text.trim().length < 10) {
                const imagePath = await pdfToImages(filePath);
                const cleanImage = await preprocessImage(imagePath);
                text = await runOCR(cleanImage);
            }
        } else if ([".jpg", ".jpeg", ".png"].includes(ext)) {
            const cleanImage = await preprocessImage(filePath);
            text = await runOCR(cleanImage);
        } else if ([".doc", ".docx"].includes(ext)) {
            text = await parseDoc(filePath);
        } else {
            // Basic support for txt for testing
            if (ext === '.txt') {
                text = fs.readFileSync(filePath, 'utf-8');
            } else {
                return res.status(400).json({ error: "Unsupported file type" });
            }
        }

        const verificationService = require("../services/verificationService");
        const result = await verificationService.verify(text, userInput, documentType.toUpperCase());

        // Cleanup
        // fs.unlinkSync(filePath); 

        res.json(result);

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ error: "Verification failed", details: error.message });
    }
}

module.exports = ocrController;
module.exports.verifyDocument = verifyDocument;

