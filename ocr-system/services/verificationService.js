const fs = require("fs");
const path = require("path");
// const { execSync } = require("child_process"); // Removed for API usage


// Configuration
const MODEL_NAME = "gemma3:1b";
const RULES_DIR = path.join(__dirname, "../rules");

/* ---------------- HELPERS ---------------- */

function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}

function loadRules(documentType) {
    let filename = "";
    switch (documentType) {
        case "DOC_AFFIDAVIT": filename = "affidavit.rules.json"; break;
        case "DOC_EC_CTE": filename = "consent_to_establish.rules.json"; break;
        case "DOC_WATER_NON_AVAIL": filename = "water_non_availability.rules.json"; break;
        case "DOC_GW_QUALITY": filename = "ground_water_quality.rules.json"; break;
        case "DOC_IA_GW": filename = "impact_assessment.rules.json"; break;
        case "DOC_MINE_PLAN": filename = "approved_mine_plan.rules.json"; break;
        case "AADHAAR": filename = "aadhaar.rules.json"; break;
        // Legacy/Default fallback
        default: filename = `${documentType.toLowerCase()}.rules.json`;
    }

    try {
        const rulesPath = path.join(RULES_DIR, filename);
        if (fs.existsSync(rulesPath)) {
            return JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
        }
    } catch (err) {
        console.error(`Error loading rules for ${documentType}:`, err);
    }
    return null;
}

/* ---------------- LOGIC ---------------- */

function runKeywordGate(docText, rules) {
    if (!rules.identification_keywords || rules.identification_keywords.length === 0) return { passed: true, hits: [], missing: [] };
    const lowerDocText = docText.toLowerCase();
    const hits = rules.identification_keywords.filter(kw => lowerDocText.includes(kw.toLowerCase()));
    return {
        passed: hits.length > 0,
        hits: hits,
        missing: rules.identification_keywords.filter(kw => !lowerDocText.includes(kw.toLowerCase()))
    };
}

function runStructuralValidation(docText, rules) {
    return { passed: true, details: "Structural validation delegated to AI/Logical phase" };
}

function runFieldValidation(docText, userInput, rules) {
    const issues = [];
    const matches = []; // Capture context for AI analysis
    if (!rules.field_rules) return { issues, matches };


    for (const [field, rule] of Object.entries(rules.field_rules)) {
        const userValue = userInput[field];

        if (!userValue) continue;

        // Check 1: Equality to a fixed rule value
        if (rule.equals) {
            if (String(userValue) !== String(rule.equals)) {
                issues.push(`Field '${field}': Value ${userValue} does not match required ${rule.equals}`);
            }
        }

        // Check 4: Exact Match in Document (Critical & Robust)
        if (rule.exact_match === true) {
            const hasDigits = /\d/.test(userValue);
            const normalize = (str) => String(str).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

            if (hasDigits) {
                // Strategy A: Compact Matching (Numbers)
                const normalizedDoc = normalize(docText);
                const normalizedUserVal = normalize(userValue);

                if (normalizedUserVal.length < 3) {
                    issues.push(`Field '${field}': Value too short for verification (${userValue})`);
                } else if (!normalizedDoc.includes(normalizedUserVal)) {
                    issues.push(`Field '${field}' mismatch: '${userValue}' not found in document.`);
                }
            } else {
                // Strategy B: Token Matching (Names) + Context Capture
                const safeUserVal = userValue.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Regex for Word Boundary to avoid "Vinod" matching "VinodKumar"
                const regex = new RegExp(`\\b${safeUserVal}\\b`, "i");
                const match = docText.match(regex);

                if (!match) {
                    // Fallback: Try "Space Normalized" match if raw fails
                    const spaceNormDoc = docText.replace(/\s+/g, " ");
                    if (!new RegExp(safeUserVal.replace(/\s+/g, " "), "i").test(spaceNormDoc)) {
                        issues.push(`Field '${field}' mismatch: '${userValue}' not found in document.`);
                    }
                } else {
                    // Match FOUND - Now enforce STRICT COMPLETENESS
                    const matchIndex = match.index;
                    const matchEnd = matchIndex + match[0].length;

                    // 1. PREFIX CHECK (Head) - Ensure we didn't match just the surname
                    const textBefore = docText.substring(0, matchIndex).split(/[\n\r]/).pop();
                    const SIGNIFICANT_HEAD_REGEX = /[a-zA-Z0-9]+[\s-]*$/; // Ends with word chars

                    let isPartial = false;
                    const matchHead = textBefore.match(SIGNIFICANT_HEAD_REGEX);

                    if (matchHead) {
                        const headWord = matchHead[0].trim();
                        // Common labels (Name:, Father's Name:, etc)
                        const HEAD_IGNORE_LIST = ["Name", "Father", "Mother", "Husband", "Wife", "Address", "Ref", "ID", "No", "DOB", "Gender", ":"];

                        const cleanHead = headWord.replace(/[^a-zA-Z0-9]/g, "");
                        if (cleanHead.length > 1 && !HEAD_IGNORE_LIST.some(label => cleanHead.toUpperCase() === label.toUpperCase())) {
                            isPartial = true;
                            issues.push(`Field '${field}' Partial Match Error: Value '${userValue}' is incomplete. Document has '...${headWord} ${userValue}'`);
                        }
                    }

                    // 2. SUFFIX CHECK (Tail) - Look ahead for "More Name" on the same line
                    const textAfter = docText.substring(matchEnd).split(/[\n\r]/)[0]; // Rest of line
                    const SIGNIFICANT_TAIL_REGEX = /^\s*[a-zA-Z0-9]+/; // Starts with word characters (ignoring space)

                    // Check if there is a 'tail' that looks like a name part, excluding known labels
                    // e.g. " Alwani" -> Significant. " DOB:" -> Not significant.

                    const matchTail = textAfter.match(SIGNIFICANT_TAIL_REGEX);

                    if (matchTail) {
                        const tailWord = matchTail[0].trim();
                        // Common labels that might follow a name in a single line context (rare in strict fields)
                        const IGNORE_LIST = ["DOB", "Gender", "Date", "Address", "S/O", "W/O", "Year"];

                        if (!IGNORE_LIST.some(label => tailWord.toUpperCase().startsWith(label.toUpperCase())) && tailWord.length > 1) {
                            isPartial = true;
                            const msg = `Field '${field}' Partial Match Error: Value '${userValue}' is incomplete. Document has '${userValue} ${tailWord}...'`;
                            issues.push(msg);
                        }
                    }

                    const start = Math.max(0, match.index - 20);
                    const end = Math.min(docText.length, match.index + userValue.length + 30);
                    const context = docText.substring(start, end).replace(/\s+/g, " ");
                    matches.push({ field, value: userValue, context, isPartial });
                }
            }
        }
    }
    return { issues, matches };
}

/* ... Authenticity Check ... */
function runAuthenticityCheck(docText, rules) {
    if (!rules.authenticity_markers) return { score: 0, hits: [] };
    const lowerDocText = docText.toLowerCase();
    const hits = rules.authenticity_markers.filter(marker => lowerDocText.includes(marker.replace(/_/g, " ").toLowerCase()));
    return { score: hits.length, hits: hits };
}


function extractJSON(text) {
    try {
        // 1. Try simple regex match (fast)
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {
                // regex matched too much or malformed, fall through to robust method
            }
        }

        // 2. Robust Brace Counting
        let startIndex = text.indexOf('{');
        if (startIndex === -1) return null;

        let braceCount = 0;
        let endIndex = -1;

        for (let i = startIndex; i < text.length; i++) {
            if (text[i] === '{') braceCount++;
            else if (text[i] === '}') braceCount--;

            if (braceCount === 0) {
                endIndex = i;
                break;
            }
        }

        if (endIndex !== -1) {
            const jsonStr = text.substring(startIndex, endIndex + 1);
            return JSON.parse(jsonStr);
        }
    } catch (err) {
        console.error("JSON Extraction Failed:", err);
    }
    return null;
}

async function aiLogicalCheckAndDecision({ docText, userInput, issues, matches, ruleVerificationResult, rules, documentType }) {

    const prompt = `
    You are a Strict Verification Engine.
    
    TASK: Verify if the User Input is an EXACT MATCH to the Document Content.

    DOCUMENT CONTEXT:
    Type: ${rules ? rules.document_name : documentType}
    
    INPUT DATA:
    ${JSON.stringify(userInput, null, 2)}

    MATCH ANALYSIS:
    ${JSON.stringify(matches, null, 2)}
    
    PRE-COMPUTED VALIDATION ISSUES:
    ${issues.length > 0 ? JSON.stringify(issues) : "NONE (Code confirmed basic strict match)"}

    STEPS TO EXECUTE:
    1. Check "PRE-COMPUTED VALIDATION ISSUES". If "NONE", the code has ALREADY confirmed that the Name/Number matches the document text strictly (checking start and end).
    2. **VERIFY CONTEXT**: Ensure the match isn't just a substring of a *different* field (e.g. matching father's name instead of applicant).
    
    CRITICAL RULES:
    1. **TRUST CODE CHECK**: If "PRE-COMPUTED VALIDATION ISSUES" is NONE, you should likely PASS, unless you see a blatant context error.
    2. **FIELD BOUNDARIES**: 
       - "Vinod Alwani" matches "Name: Vinod Alwani S/O ..." -> PASS.
       - "S/O", "DOB", "Address" mark the START of a NEW field. They are NOT part of the Name.
       - Do NOT fail because User Input excludes the Father's Name or Address.
    3. **NO PARTIALS**: Input "Vinod" vs Doc "Vinod Alwani" -> FAIL.

    Output JSON:
    {
      "verdict": "PASS" | "FAIL",
      "risk_score": 0-100,
      "confidence": 0-100,
      "summary": "Explain the comparison."
    }
    `;

    try {
        console.log(`🤖 Consulting External AI (${MODEL_NAME})...`);
        const apiUrl = process.env.POINT;

        if (!apiUrl) {
            throw new Error("Missing AI Service URL (POINT) in .env");
        }

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: MODEL_NAME,
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const apiData = await response.json();
        const result = apiData.response || ""; // Ollama API returns 'response' field


        let cleanResult = result.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
        cleanResult = cleanResult.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

        const data = extractJSON(cleanResult);
        if (data) {
            return data;
        } else {
            console.warn("LLM did not return Valid JSON. Raw:", cleanResult);
            return { verdict: "MANUAL_REVIEW", summary: "AI failed to produce structured output.", risk_score: 99 };
        }
    } catch (err) {
        console.error("LLM Error:", err);
        return { verdict: "MANUAL_REVIEW", summary: "System Error during AI processing.", risk_score: 100 };
    }
}



/* ---------------- MAIN SERVICE ---------------- */

async function verify(docText, userInput, documentType) {
    console.log("--- START VERIFICATION ---");
    console.log("Document Type:", documentType);

    const rules = loadRules(documentType);
    console.log("Rules Loaded:", rules ? "YES" : "NO");

    if (!rules) {
        console.log("DECISION: No Rules Found");
        return {
            status: "FAIL",
            document_code: "UNKNOWN",
            verdict: {
                verdict: "FAIL",
                risk_score: 100,
                confidence: 0,
                summary: `No verification rules found for Document Type: '${documentType}'. Check spelling or supported types.`
            },
            verification_log: {}
        };
    }

    // 1. Keyword Gate
    const keywordGate = rules ? runKeywordGate(docText, rules) : { passed: true, hits: [] };
    console.log("Keyword Gate:", keywordGate.passed);

    // 2. Structural & Field
    const structural = rules ? runStructuralValidation(docText, rules) : { passed: true };
    const fieldValidation = rules ? runFieldValidation(docText, userInput, rules) : { issues: [], matches: [] };
    const fieldIssues = fieldValidation.issues;
    const fieldMatches = fieldValidation.matches;
    console.log("Field Issues:", fieldIssues.length);

    // 3. Authenticity
    const authenticity = rules ? runAuthenticityCheck(docText, rules) : { score: 0, hits: [] };

    let finalDecision;

    // Critical Gate Failure
    if (!keywordGate.passed && rules) {
        console.log("DECISION: Gate Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: "Document failed Critical Keyword Gate. Identifying keywords not found."
        };
    }
    // Field Validation Failure (Fail Fast)
    else if (fieldIssues.length > 0) {
        console.log("DECISION: Field Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: `Field Validation Failed.found ${fieldIssues.length} issues: ${fieldIssues.join("; ")}`
        };
    }
    else {
        console.log("DECISION: Calling AI...");
        finalDecision = await aiLogicalCheckAndDecision({
            docText,
            userInput,
            issues: fieldIssues,
            matches: fieldMatches,
            ruleVerificationResult: { keywordGate, structural, authenticity },
            rules,
            documentType
        });
        console.log("AI Result:", JSON.stringify(finalDecision));
    }

    // Standardize Verdict to PASS/FAIL if AI returns ACCEPT/REJECT
    if (finalDecision.verdict === "ACCEPT") finalDecision.verdict = "PASS";
    if (finalDecision.verdict === "REJECT") finalDecision.verdict = "FAIL";

    return {
        status: finalDecision.verdict,
        document_code: rules ? rules.document_code : "UNKNOWN",
        verdict: finalDecision,
        verification_log: {
            keyword_gate: keywordGate,
            structural_check: structural,
            field_validation_issues: fieldIssues,
            authenticity_markers_detected: authenticity.hits
        }
    };
}

module.exports = { verify };
