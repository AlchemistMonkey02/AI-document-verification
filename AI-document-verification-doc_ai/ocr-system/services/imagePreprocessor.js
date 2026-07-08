const sharp = require("sharp");
const path = require("path");

async function preprocessImage(imagePath) {
    try {
        const ext = path.extname(imagePath);
        const basename = path.basename(imagePath, ext);
        const dirname = path.dirname(imagePath);
        const output = path.join(dirname, `${basename}_clean${ext}`);

        await sharp(imagePath)
            .grayscale()
            .normalize()
            .threshold(150)
            .toFile(output);

        return output;
    } catch (error) {
        console.error("Error preprocessing image:", error);
        throw new Error("Failed to preprocess image");
    }
}

module.exports = preprocessImage;
