const { createWorker } = require("tesseract.js");

async function runOCR(imagePath) {
    let worker;
    try {
        // Initialize worker with both English and Hindi languages
        worker = await createWorker("eng+hin");
        const { data } = await worker.recognize(imagePath);
        await worker.terminate();
        return data.text;
    } catch (error) {
        if (worker) await worker.terminate();
        console.error("Error running OCR:", error);
        throw new Error("Failed to perform OCR");
    }
}

module.exports = runOCR;
