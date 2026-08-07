const { createWorker } = require("tesseract.js");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const KEYWORDS_TO_CHECK = [
    "attendance", "उपस्थिति", "muster", "sheet",
    "completion", "certificate", "पूर्णता", "प्रमाण",
    "work order", "कार्यादेश", "आदेश", "sanction",
    "capacity", "building", "training", "rajasthan",
    "सरकार", "विभाग", "दिनांक", "कार्यालय"
];

function scoreText(text) {
    if (!text) return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const kw of KEYWORDS_TO_CHECK) {
        if (lower.includes(kw)) hits++;
    }
    return hits;
}

async function runOCR(imagePath) {
    let worker;
    try {
        worker = await createWorker("eng+hin");

        const { data: baseData } = await worker.recognize(imagePath);
        let bestText = baseData.text;
        let bestScore = scoreText(bestText);
        let bestAngle = 0;

        // If score is low (< 2), test rotations (270, 90, 180) to fix sideways / upside-down documents
        if (bestScore < 2) {
            const dirname = path.dirname(imagePath);
            const ext = path.extname(imagePath);
            const basename = path.basename(imagePath, ext);

            for (const angle of [270, 90, 180]) {
                try {
                    const rotPath = path.join(dirname, `${basename}_rot${angle}${ext}`);
                    await sharp(imagePath).rotate(angle).toFile(rotPath);

                    const { data: rotData } = await worker.recognize(rotPath);
                    const rotScore = scoreText(rotData.text);

                    if (rotScore > bestScore) {
                        bestScore = rotScore;
                        bestText = rotData.text;
                        bestAngle = angle;
                    }

                    if (fs.existsSync(rotPath)) fs.unlinkSync(rotPath);

                    if (bestScore >= 2) break;
                } catch (e) {
                    console.error(`Error trying rotation ${angle}°:`, e.message);
                }
            }
        }

        if (bestAngle !== 0) {
            console.log(`[Auto-Orientation] Corrected image orientation to ${bestAngle}° (keywords found: ${bestScore}).`);
        }

        await worker.terminate();
        return bestText;
    } catch (error) {
        if (worker) await worker.terminate();
        console.error("Error running OCR:", error);
        throw new Error("Failed to perform OCR");
    }
}

module.exports = runOCR;
