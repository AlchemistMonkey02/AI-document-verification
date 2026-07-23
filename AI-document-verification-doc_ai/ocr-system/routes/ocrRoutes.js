const express = require("express");
const multer = require("multer");
const path = require("path");
const ocrController = require("../controllers/ocrController");

const router = express.Router();

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const upload = multer({ storage: storage });

// Legacy / OCR endpoints
router.post("/ocr", upload.single("file"), ocrController);
router.post("/verify-document", upload.single("file"), ocrController.verifyDocument);
router.post("/verify-document/:document_type", upload.single("file"), ocrController.verifyDocument);

// Dedicated 3 core document API endpoints (uploaded one by one)
router.post("/verify/completion-certificate", upload.single("file"), ocrController.verifyCompletionCertificate);
router.post("/verify/attendance", upload.single("file"), ocrController.verifyAttendance);
router.post("/verify/work-order", upload.single("file"), ocrController.verifyWorkOrder);

// Dedicated helper shortcuts
router.post("/verify-completion-certificate", upload.single("file"), ocrController.verifyCompletionCertificate);
router.post("/verify-attendance", upload.single("file"), ocrController.verifyAttendance);
router.post("/verify-work-order", upload.single("file"), ocrController.verifyWorkOrder);

// Package verification (multi-file batch)
router.post("/verify-package", upload.array("files", 10), ocrController.verifyPackage);

// Generic single-document fallback API route
router.post("/verify/:document_type", upload.single("file"), ocrController.verifySingleDocumentType);

module.exports = router;
