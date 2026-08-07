const fs = require('fs');
const pdf = require('pdf-parse');

async function checkPdf(filename) {
    console.log(`--- ${filename} ---`);
    const dataBuffer = fs.readFileSync(filename);
    try {
        const data = await pdf(dataBuffer);
        console.log("Text length:", data.text.length);
        console.log("Snippet:", data.text.substring(0, 500).replace(/\s+/g, ' '));
    } catch (e) {
        console.error("Error parsing pdf:", e);
    }
}

checkPdf("sathin.pdf");
checkPdf("mandrayal.pdf");
