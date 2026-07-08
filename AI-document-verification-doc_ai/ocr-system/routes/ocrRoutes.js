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

router.post("/ocr", upload.single("file"), ocrController);
router.post("/verify-document", upload.single("file"), ocrController.verifyDocument);
router.post("/verify-document/:document_type", upload.single("file"), ocrController.verifyDocument);

module.exports = router;
