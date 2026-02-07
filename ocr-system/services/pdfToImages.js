const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);

let pdfPoppler;
// pdf-poppler throws/exits on non-Windows systems immediately upon require
if (process.platform === 'win32') {
    try {
        pdfPoppler = require("pdf-poppler");
    } catch (e) {
        console.log("pdf-poppler module not available, falling back to system pdftocairo.");
    }
} else {
    console.log("Linux detected: Skipping pdf-poppler require, using system pdftocairo.");
}

async function pdfToImages(pdfPath) {
    const outputDir = path.dirname(pdfPath).replace("uploads", "output");
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const opts = {
        format: "png",
        out_dir: outputDir,
        out_prefix: path.basename(pdfPath, path.extname(pdfPath)),
        page: null // null means all pages
    };

    try {
        if (pdfPoppler) {
            // pdf-poppler converts and saves files to out_dir
            await pdfPoppler.convert(pdfPath, opts);
        } else {
            // Fallback for Linux/Docker where pdf-poppler fails
            // Construct command: pdftocairo -png input.pdf output_prefix
            const outputPrefix = path.join(opts.out_dir, opts.out_prefix);
            const cmd = `pdftocairo -png "${pdfPath}" "${outputPrefix}"`;
            console.log("Executing fallback command:", cmd);
            await execPromise(cmd);
        }

        // Return path to the first page image for simplicity (or handle multiple)
        // The user's controller logic seems to process 'page-1.png'
        const firstPageImage = path.join(opts.out_dir, `${opts.out_prefix}-1.png`);
        return firstPageImage;
    } catch (error) {
        console.error("Error converting PDF to images:", error);
        throw new Error("Failed to convert PDF to images");
    }
}

module.exports = pdfToImages;
