const detectFileType = require("../services/fileDetector");
const parseDoc = require("../services/docParser");
const parsePDF = require("../services/pdfTextExtractor");
const pdfToImages = require("../services/pdfToImages");
const preprocessImage = require("../services/imagePreprocessor");
const runOCR = require("../services/ocrEngine");
const buildJSON = require("../services/jsonBuilder");
const verificationService = require("../services/verificationService");
const fs = require("fs");

async function extractTextFromFile(filePath) {
    const ext = detectFileType(filePath);
    let text = "";

    if (ext === ".pdf") {
        text = await parsePDF(filePath);
        if (!text || text.trim().length < 10) {
            console.log("PDF seems to be scanned, converting to images...");
            const imagePath = await pdfToImages(filePath);
            const cleanImage = await preprocessImage(imagePath);
            text = await runOCR(cleanImage);
        }
    } else if ([".jpg", ".jpeg", ".png"].includes(ext)) {
        const cleanImage = await preprocessImage(filePath);
        text = await runOCR(cleanImage);
    } else if ([".doc", ".docx"].includes(ext)) {
        text = await parseDoc(filePath);
    } else if (ext === '.txt') {
        text = fs.readFileSync(filePath, 'utf-8');
    } else {
        throw new Error("Unsupported file type: " + ext);
    }

    return text;
}

async function ocrController(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;

    try {
        const text = await extractTextFromFile(filePath);
        const compareText = require("../services/textComparator");

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const requestedDocType = req.body.documentType || req.body.document_type || "AUTO";

        const verification = await verificationService.verify(text, userInput, requestedDocType);

        if (verification.status === "FAIL") {
            return res.status(400).json({
                error: "Document verification failed. Uploaded document is fake or incorrect.",
                status: "FAIL",
                document_code: verification.document_code,
                verdict: verification.verdict,
                verification_log: verification.verification_log
            });
        }

        const json = buildJSON(text);
        json.status = "PASS";
        json.document_code = verification.document_code;
        json.verification = verification;

        if (req.body.user_input || req.body.inputText) {
            const comparison = compareText(text, typeof rawInput === 'string' ? rawInput : JSON.stringify(userInput));
            json.comparison = comparison;
        }

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

        const documentType = req.params.document_type || req.body.documentType || req.body.document_type || "AUTO";

        const filePath = req.file.path;
        const text = await extractTextFromFile(filePath);

        const result = await verificationService.verify(text, userInput, documentType);

        res.json(result);

    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ error: "Verification failed", details: error.message });
    }
}

async function verifySingleDocumentType(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document uploaded for verification" });
        }

        const documentTypeParam = req.params.document_type || req.body.documentType || req.body.document_type;
        if (!documentTypeParam) {
            return res.status(400).json({ error: "Document type parameter is required for single document verification." });
        }

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const filePath = req.file.path;
        const text = await extractTextFromFile(filePath);

        const targetCode = verificationService.resolveDocumentCode(documentTypeParam);
        const result = await verificationService.verify(text, userInput, targetCode);

        if (result.status === "FAIL") {
            return res.status(400).json({
                error: "Document verification failed. Uploaded document is fake or incorrect.",
                status: "FAIL",
                requested_document_type: targetCode,
                result
            });
        }

        res.json({
            status: "PASS",
            requested_document_type: targetCode,
            result
        });

    } catch (error) {
        console.error("Single Document Verification Error:", error);
        res.status(500).json({ error: "Single document verification failed", details: error.message });
    }
}

async function verifyCompletionCertificate(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document uploaded for completion certificate check" });
        }

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const filePath = req.file.path;
        const text = await extractTextFromFile(filePath);

        const result = await verificationService.verifyCompletionCertificate(text, userInput);

        if (result.status === "FAIL" || !result.is_completion_certificate) {
            return res.status(400).json({
                error: "Document verification failed. Uploaded document is fake or incorrect.",
                status: "FAIL",
                is_completion_certificate: false,
                result
            });
        }

        res.json(result);

    } catch (error) {
        console.error("Completion Certificate Verification Error:", error);
        res.status(500).json({ error: "Completion certificate verification failed", details: error.message });
    }
}

async function verifyAttendance(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document uploaded for attendance check" });
        }

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const filePath = req.file.path;
        const text = await extractTextFromFile(filePath);

        const result = await verificationService.verifyAttendance(text, userInput);

        if (result.status === "FAIL" || !result.is_attendance_sheet) {
            return res.status(400).json({
                error: "Document verification failed. Uploaded document is fake or incorrect.",
                status: "FAIL",
                is_attendance_sheet: false,
                result
            });
        }

        res.json(result);

    } catch (error) {
        console.error("Attendance Verification Error:", error);
        res.status(500).json({ error: "Attendance verification failed", details: error.message });
    }
}

async function verifyWorkOrder(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No document uploaded for work order check" });
        }

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const filePath = req.file.path;
        const text = await extractTextFromFile(filePath);

        const result = await verificationService.verifyWorkOrder(text, userInput);

        if (result.status === "FAIL" || !result.is_work_order) {
            return res.status(400).json({
                error: "Document verification failed. Uploaded document is fake or incorrect.",
                status: "FAIL",
                is_work_order: false,
                result
            });
        }

        res.json(result);

    } catch (error) {
        console.error("Work Order Verification Error:", error);
        res.status(500).json({ error: "Work order verification failed", details: error.message });
    }
}

async function verifyPackage(req, res) {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: "No document package uploaded. Uploaded files must include Attendance Record and Completion Certificate." });
        }

        let userInput = {};
        const rawInput = req.body.inputText || req.body.user_input;
        if (typeof rawInput === 'string') {
            try { userInput = JSON.parse(rawInput); } catch (e) {}
        } else if (typeof rawInput === 'object') {
            userInput = rawInput;
        }

        const documentResults = [];
        let hasCompletionCertificate = false;
        let hasAttendanceSheet = false;

        for (const file of files) {
            try {
                const text = await extractTextFromFile(file.path);
                const result = await verificationService.verify(text, userInput, "AUTO");
                
                if (result.is_completion_certificate || result.document_code === "DOC_COMPLETION_CERT") {
                    hasCompletionCertificate = true;
                }

                if (result.is_attendance_sheet || result.document_code === "DOC_ATTENDANCE") {
                    hasAttendanceSheet = true;
                }

                documentResults.push({
                    original_name: file.originalname,
                    verification: result
                });
            } catch (err) {
                documentResults.push({
                    original_name: file.originalname,
                    error: err.message
                });
            }
        }

        const missingRequired = [];
        if (!hasAttendanceSheet) missingRequired.push("Attendance Record (DOC_ATTENDANCE)");
        if (!hasCompletionCertificate) missingRequired.push("Completion Certificate (DOC_COMPLETION_CERT)");

        if (missingRequired.length > 0) {
            return res.status(400).json({
                error: "Upload package rejected. Mandatory document(s) are missing or fake.",
                status: "FAIL",
                checklist: {
                    attendance_sheet_present: hasAttendanceSheet,
                    completion_certificate_present: hasCompletionCertificate,
                    missing_required_documents: missingRequired
                },
                documents: documentResults
            });
        }

        res.json({
            status: "PASS",
            checklist: {
                attendance_sheet_present: true,
                completion_certificate_present: true,
                missing_required_documents: []
            },
            total_documents: files.length,
            documents: documentResults
        });

    } catch (error) {
        console.error("Package Verification Error:", error);
        res.status(500).json({ error: "Package verification failed", details: error.message });
    }
}

module.exports = ocrController;
module.exports.verifyDocument = verifyDocument;
module.exports.verifySingleDocumentType = verifySingleDocumentType;
module.exports.verifyCompletionCertificate = verifyCompletionCertificate;
module.exports.verifyAttendance = verifyAttendance;
module.exports.verifyWorkOrder = verifyWorkOrder;
module.exports.verifyPackage = verifyPackage;
