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
    const absolutePdfPath = path.resolve(pdfPath);
    const outputDir = path.resolve(path.dirname(absolutePdfPath).replace("uploads", "output"));
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const opts = {
        format: "png",
        out_dir: outputDir,
        out_prefix: path.basename(absolutePdfPath, path.extname(absolutePdfPath)),
        page: null // null means all pages
    };

    try {
        if (pdfPoppler) {
            // pdf-poppler converts and saves files to out_dir
            await pdfPoppler.convert(absolutePdfPath, opts);
        } else {
            // Fallback for Linux/Docker where pdf-poppler fails
            // Construct command: pdftocairo -png input.pdf output_prefix
            const outputPrefix = path.join(opts.out_dir, opts.out_prefix);
            const cmd = `pdftocairo -png "${absolutePdfPath}" "${outputPrefix}"`;
            console.log("Executing fallback command:", cmd);
            const { stdout, stderr } = await execPromise(cmd);
            console.log("Command stdout:", stdout);
            console.log("Command stderr:", stderr);
        }

        // Return paths to all page images sorted by name, avoiding clean/temp files
        const files = fs.readdirSync(opts.out_dir);
        const matchingFiles = files.filter(f => f.startsWith(opts.out_prefix) && /-\d+\.png$/.test(f));
        if (matchingFiles.length === 0) {
            throw new Error(`Output image file was not created. No PNG files starting with prefix "${opts.out_prefix}" found in directory "${opts.out_dir}". Directory contents: ${files.join(", ")}`);
        }
        matchingFiles.sort();
        const allPageImages = matchingFiles.map(file => path.join(opts.out_dir, file));
        return allPageImages;
    } catch (error) {
        console.error("Error converting PDF to images:", error);
        throw new Error("Failed to convert PDF to images: " + error.message);
    }
}

module.exports = pdfToImages;
