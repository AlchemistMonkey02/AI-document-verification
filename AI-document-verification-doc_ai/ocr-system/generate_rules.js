const fs = require("fs");
const path = require("path");
const poppler = require("pdf-poppler");
const Tesseract = require("tesseract.js");
const { execSync } = require("child_process");

const SPLIT_DIR = path.join(__dirname, "ilovepdf_split");
const RULES_DIR = path.join(__dirname, "rules");
const MODEL_NAME = "qwen3:4b";

async function generateRuleForPDF(filename) {
    const pdfPath = path.join(SPLIT_DIR, filename);
    const baseName = path.parse(filename).name;
    const rulePath = path.join(RULES_DIR, `${baseName}.rules.json`);

    console.log(`\nProcessing ${filename}...`);

    if (fs.existsSync(rulePath)) {
        console.log(`Rule already exists: ${rulePath}. Skipping.`);
        return;
    }

    try {
        // Generate simple generic rule without LLM or OCR
        const ruleObj = {
            document_code: baseName,
            document_name: "Report Baran Page",
            document_domain: "GENERAL",
            identification: {
                primary_keywords: [],
                min_keyword_hits: 0
            },
            mandatory_sections: [],
            logical_rules: [],
            verification_level: "NORMAL"
        };
        
        fs.writeFileSync(rulePath, JSON.stringify(ruleObj, null, 4));
        console.log(`✅ Saved rule: ${rulePath}`);

    } catch (err) {
        console.error(`Error processing ${filename}:`, err);
    }
}

async function main() {
    const files = fs.readdirSync(SPLIT_DIR).filter(f => f.endsWith(".pdf"));
    console.log(`Found ${files.length} PDF files.`);
    
    for (const file of files) {
        await generateRuleForPDF(file);
    }
    console.log("Done generating all rules.");
}

main();
