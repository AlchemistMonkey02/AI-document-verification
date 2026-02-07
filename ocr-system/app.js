require('dotenv').config();
const express = require("express");
const ocrRoutes = require("./routes/ocrRoutes");
const path = require("path");
const fs = require("fs");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5005;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Ensure required directories exist on startup
const dirs = ["uploads", "output"];
dirs.forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) {
        fs.mkdirSync(p);
    }
});

// Routes
// Routes
// Routes
app.use("/", ocrRoutes);

app.get('/', (req, res) => {
    res.send("OCR System API is running. POST to /ocr to process files.");
});


// Health Check
// Health Check
// app.get("/", (req, res) => {
//     res.send("OCR System API is running. POST to /ocr to process files.");
// });

// Start server
app.listen(PORT, () => {
    console.log(`OCR System running on http://localhost:${PORT}`);
});
