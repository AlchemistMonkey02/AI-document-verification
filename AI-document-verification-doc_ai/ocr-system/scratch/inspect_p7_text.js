const sharp = require('sharp');
const path = require('path');
const { createWorker } = require('tesseract.js');

async function testP7Text() {
    const worker = await createWorker('eng+hin');
    const p7Path = path.join(__dirname, '../PAI 2.0-07.png');
    const rotPath = path.join(__dirname, '../PAI_07_rot_270.png');
    await sharp(p7Path).rotate(270).toFile(rotPath);

    const { data } = await worker.recognize(rotPath);
    console.log("=== Page 7 Text at 270° ===");
    console.log(data.text);
    await worker.terminate();
}

testP7Text();
