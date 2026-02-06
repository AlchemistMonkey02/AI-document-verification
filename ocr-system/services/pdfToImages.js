const pdfPoppler = require("pdf-poppler");
const path = require("path");
const fs = require("fs");

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
        // pdf-poppler converts and saves files to out_dir
        await pdfPoppler.convert(pdfPath, opts);

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
