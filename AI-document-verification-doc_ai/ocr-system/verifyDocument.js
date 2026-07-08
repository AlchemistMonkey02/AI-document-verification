const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');

// Setup OpenAI Client connecting to the local Ollama instance via the domain!
const client = new OpenAI({
    baseURL: 'https://ai.geoplanetsolution.in/v1',
    apiKey: 'ollama',
});

const MODEL_NAME = 'qwen3:4b';

async function extractTextFromPDF(pdfPath) {
    try {
        let dataBuffer = fs.readFileSync(pdfPath);
        let data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        return `Error extracting PDF: ${error.message}`;
    }
}

async function extractTextFromDOCX(docxPath) {
    try {
        const result = await mammoth.extractRawText({ path: docxPath });
        return result.value;
    } catch (error) {
        return `Error extracting DOCX: ${error.message}`;
    }
}

function loadRules() {
    const rulesDir = path.join(__dirname, 'rules');
    const rules = [];
    if (fs.existsSync(rulesDir)) {
        const files = fs.readdirSync(rulesDir);
        for (const file of files) {
            if (file.endsWith('.rules.json')) {
                const ruleContent = fs.readFileSync(path.join(rulesDir, file), 'utf8');
                try {
                    rules.push(JSON.parse(ruleContent));
                } catch (e) {
                    console.error(`Error parsing rule file ${file}`);
                }
            }
        }
    }
    return rules;
}

function findMatchingRule(text, rules) {
    for (const rule of rules) {
        if (!rule.identification || !rule.identification.primary_keywords) continue;
        
        let matchCount = 0;
        for (const keyword of rule.identification.primary_keywords) {
            // Case insensitive match
            if (text.toLowerCase().includes(keyword.toLowerCase())) {
                matchCount++;
            }
        }
        
        const minHits = rule.identification.min_keyword_hits || 1;
        if (matchCount >= minHits) {
            return rule;
        }
    }
    return null;
}

async function verifyDocument(filePath) {
    console.log(`[*] Processing file: ${filePath}`);

    let textContent = '';
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        textContent = await extractTextFromPDF(filePath);
    } else if (ext === '.docx') {
        textContent = await extractTextFromDOCX(filePath);
    } else {
        console.log('[!] Unsupported file format. Please provide a .pdf or .docx file.');
        return;
    }

    if (textContent.startsWith('Error')) {
        console.log(textContent);
        return;
    }

    const systemRules = loadRules();
    console.log(`[*] Loaded ${systemRules.length} rule definitions from the rules folder.`);
    
    // Pre-filter the rules in Javascript to prevent sending too much data to the AI
    let matchedRule = findMatchingRule(textContent, systemRules);
    
    if (!matchedRule) {
        console.log('[!] Warning: Could not find an exact keyword match. This is likely due to the PDF being a scanned image with poor embedded OCR text, or an entirely incorrect document.');
        console.log(`[*] Extracted Text Snippet: "${textContent.replace(/\n/g, ' ').substring(0, 100)}..."`);
        console.log('[*] ERROR: Document does not match any known template rules. Rejecting.');
        console.log('\n--- AI VERIFICATION RESULT ---');
        console.log(JSON.stringify({
            "matched_document_code": "UNKNOWN",
            "status": "FAKE",
            "reason": "The uploaded document did not contain the required identification keywords for any expected document type. It is either the wrong document or completely illegible."
        }, null, 2));
        console.log('------------------------------\n');
        return;
    }
    
    console.log(`[*] Matched template: ${matchedRule.document_code}. Sending to AI for verification...`);

    const systemPrompt = `You are a highly secure Fraud Detection AI analyzing document text.

You MUST enforce every single check, mandatory section, field, and logical rule defined in the verification template below.

If ANY of the rules from the template are violated, the document is FAKE. Otherwise, it is REAL.

--- VERIFICATION ENGINE RULES ---
${JSON.stringify(matchedRule, null, 2)}
---------------------------------

Return ONLY valid JSON in the following format, with no markdown formatting or backticks around it:
{
  "matched_document_code": "${matchedRule.document_code}",
  "status": "REAL or FAKE",
  "reason": "Detailed explanation of why it passed or failed, referencing the specific rules that were checked."
}`;

    try {
        const response = await client.chat.completions.create({
            model: MODEL_NAME,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Document Text:\n\n${textContent}` }
            ],
            temperature: 0.1,
        });

        const resultJson = response.choices[0].message.content;
        console.log('\n--- AI VERIFICATION RESULT ---');
        console.log(resultJson);
        console.log('------------------------------\n');

    } catch (error) {
        console.error(`[!] API Request Failed: ${error.message}`);
    }
}

// Run if called from command line
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node verifyDocument.js <path-to-file>');
        process.exit(1);
    }
    
    const filePath = args[0];
    if (fs.existsSync(filePath)) {
        verifyDocument(filePath);
    } else {
        console.log(`File not found: ${filePath}`);
    }
}
