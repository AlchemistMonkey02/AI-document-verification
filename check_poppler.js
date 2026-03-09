try {
    const pdfPoppler = require("pdf-poppler");
    console.log("pdf-poppler loaded successfully");
} catch (e) {
    console.error("Error loading pdf-poppler:");
    console.error(e.message);
}
