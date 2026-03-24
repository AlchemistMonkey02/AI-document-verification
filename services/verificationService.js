const fs = require("fs");
const path = require("path");
const { extractDocumentFields, formatKey } = require("../utils/universalDocumentExtractor");


// Configuration
const MODEL_NAME = "gemma3:1b";
const RULES_DIR = path.join(__dirname, "../rules");

/* ---------------- HELPERS ---------------- */

function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}

function refineSummary(summary, data) {
    if (!summary || !data) return summary;
    let refined = summary;

    // Normalize data keys to help matching
    const name = data.name || data.project_name || data.user_name || "Unknown Name";
    const id = data.id_number || data.consent_number || data.aadhaar_number || data.pan_number || data.id || "Unknown ID";
    const date = data.issue_date || data.date || data.date_of_birth || "Unknown Date";
    const expiry = data.expiry_date || data.validity || "N/A";

    const replacements = {
        "[PROJECT_NAME]": name,
        "[NAME]": name,
        "[ID_NUMBER]": id,
        "[ID]": id,
        "[DATE]": date,
        "[EXPIRY]": expiry,
        "[NAME_IN_OCR]": name,
        "[ID_IN_OCR]": id,
        "[VALUE_IN_OCR]": "the document value",
        "[VALUE_IN_INPUT]": "your input",
        "[FIELD]": "field"
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        refined = refined.split(placeholder).join(value);
    }
    return refined;
}

function buildDynamicSummary(verdict, documentData, issues, warning = "") {
    const entries = Object.entries(documentData || {});
    const details = entries.map(([key, value]) => `${formatKey(key)}: ${value}`);
    const detailText = details.length
        ? `Document details detected: ${details.join(", ")}.`
        : "Basic document information detected.";

    let summary = "";
    if (verdict === "PASS") {
        summary = `Your document was successfully verified. ${detailText} All provided application details matched the document and required authenticity checks passed.`;
    } else {
        const failedFieldNames = (issues || []).map(issue => {
            const match = issue.match(/Field '([^']+)'/);
            return match ? formatKey(match[1]) : null;
        }).filter(Boolean);

        if (failedFieldNames.length) {
            summary = `Document verification failed. ${detailText} The following fields did not match the document: ${[...new Set(failedFieldNames)].join(", ")}.`;
        } else {
            summary = `Document verification failed due to validation errors. ${detailText}`;
        }
    }

    if (warning) {
        summary += ` ${warning}`;
    }
    return summary;
}

function loadRules(documentType) {
    let filename = `${documentType}.rules.json`;

    // Legacy Mapping
    const legacyMap = {
        "AADHAAR": "DOC_AADHAAR.rules.json",
        "PAN": "DOC_PAN_COMPANY.rules.json", // Assuming PAN Company for now, or need generic PAN?
        // Add other legacy maps if known
        "EC": "DOC_EC_CTE.rules.json",
        "CTE": "DOC_EC_CTE.rules.json"
    };

    if (legacyMap[documentType]) {
        filename = legacyMap[documentType];
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
    if (!rules.identification) return { passed: true, hits: [], missing: [] };

    const { primary_keywords = [], secondary_keywords = [], min_keyword_hits = 1 } = rules.identification;
    const lowerDocText = docText.toLowerCase();

    const checkKeywords = (kws) => kws.filter(kw => lowerDocText.includes(kw.toLowerCase()));

    const primaryHits = checkKeywords(primary_keywords);
    const secondaryHits = checkKeywords(secondary_keywords);
    const totalHits = primaryHits.length + secondaryHits.length;

    // Fail if ANY primary keyword is missing (if primary list is provided)
    // NOTE: The user prompt implied primary keywords are strong indicators. 
    // Usually "primary" means MUST be present, or at least one of them.
    // Let's assume at least ONE primary keyword is required if the list exists, 
    // OR we just respect min_keyword_hits across the board.
    // The prompt implementation guidelines say "primary_keywords: []". 
    // Let's stick to min_keyword_hits as the gate for now, but prioritize primary in logic if needed.

    // Strictness: If primary keywords exist, at least ONE must be found? 
    // The schema doesn't explicitly say "all primary required", but "identificarion" implies it.
    // Let's use min_keyword_hits as the main driver.

    const missingPrimary = primary_keywords.filter(kw => !lowerDocText.includes(kw.toLowerCase()));

    const passed = totalHits >= min_keyword_hits;

    return {
        passed,
        hits: [...primaryHits, ...secondaryHits],
        missing: missingPrimary.concat(secondary_keywords.filter(kw => !lowerDocText.includes(kw.toLowerCase()))),
        details: `Found ${totalHits} keywords (Min required: ${min_keyword_hits})`
    };
}

function runStructuralValidation(docText, rules) {
    return { passed: true, details: "Structural validation delegated to AI/Logical phase" };
}

function runFieldValidation(docText, userInput, rules) {
    const issues = [];
    const matches = [];
    if (!rules.fields) return { issues, matches };

    for (const [field, rule] of Object.entries(rules.fields)) {
        const userValue = userInput[field];

        // 1. Check Requirement
        if (rule.required && !userValue) {
            continue;
        }

        if (!userValue) continue;

        // 2. Regex Check
        if (rule.regex) {
            const regex = new RegExp(rule.regex);
            if (!regex.test(userValue)) {
                issues.push(`Field '${field}': Value '${userValue}' does not match format ${rule.regex}`);
            }
        }

        // 3. Match Strategy
        if (rule.match_strategy === "STRICT") {
            const hasDigits = /\d/.test(userValue);
            const normalize = (str) => String(str).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

            if (hasDigits) {
                // Strict Numeric/Alphanumeric
                const normalizedDoc = normalize(docText);
                const normalizedUserVal = normalize(userValue);
                if (!normalizedDoc.includes(normalizedUserVal)) {
                    issues.push(`Field '${field}' mismatch: '${userValue}' not found in document (STRICT).`);
                }
            } else {
                // Strict Text
                const safeUserVal = userValue.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${safeUserVal}\\b`, "i");
                if (!regex.test(docText)) {
                    // Fallback check: ignore spaces
                    const spaceNormDoc = docText.replace(/\s+/g, "");
                    const spaceNormVal = userValue.replace(/\s+/g, "");
                    if (!new RegExp(spaceNormVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i").test(spaceNormDoc)) {
                        issues.push(`Field '${field}' mismatch: '${userValue}' not found in document (STRICT).`);
                    }
                }
            }
        } else if (rule.match_strategy === "FLEXIBLE") {
            // Flexible: Case insensitive, maybe ignore separators
            const normalize = (str) => String(str).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
            if (!normalize(docText).includes(normalize(userValue))) {
                // Even flexible failed
                issues.push(`Field '${field}' mismatch: '${userValue}' not found (FLEXIBLE).`);
            }
        } else if (rule.match_strategy === "SEMANTIC") {
            // SEMANTIC is handled by AI later, but we can provide a hint
            const norm = (str) => String(str).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
            const normalizedDoc = norm(docText);
            const normalizedUserVal = norm(userValue);

            if (!normalizedDoc.includes(normalizedUserVal)) {
                // Not a hard failure for SEMANTIC, but a high-priority issue for AI to check
                issues.push(`Field '${field}': Input '${userValue}' not found in OCR text. AI must verify if a similar or related value exists (e.g., nicknames, abbreviations, or different languages). IF NO SEMANTIC MATCH EXISTS, YOU MUST FAIL.`);
            }
        }

        matches.push({ field, value: userValue, strategy: rule.match_strategy });
    }
    return { issues, matches };
}

/* ... Authenticity Check ... */
function runAuthenticityCheck(docText, rules) {
    if (!rules.authenticity) return { score: 0, hits: [] };

    const { required = [], optional = [] } = rules.authenticity;
    const allMarkers = [...required, ...optional];

    if (allMarkers.length === 0) return { score: 0, hits: [] };

    const lowerDocText = docText.toLowerCase();
    const hits = allMarkers.filter(marker => lowerDocText.includes(marker.replace(/_/g, " ").toLowerCase()));

    // Check if all MANDATORY ones are present
    const missingRequired = required.filter(marker => !lowerDocText.includes(marker.replace(/_/g, " ").toLowerCase()));
    const passed = missingRequired.length === 0;

    return {
        score: hits.length,
        hits: hits,
        passed,
        missing_required: missingRequired
    };
}

function runIssuingAuthorityCheck(docText, rules) {
    if (!rules.issuing_authority) return { passed: true, hits: [] };

    const { allowed = [], regex = [], must_be_present = false } = rules.issuing_authority;

    // If not strict, we skip failing but still look for it
    if (!must_be_present && allowed.length === 0 && regex.length === 0) {
        return { passed: true, hits: [] };
    }

    const lowerDocText = docText.toLowerCase();
    const allowedHits = allowed.filter(auth => lowerDocText.includes(auth.toLowerCase()));

    // Regex checks
    const regexHits = [];
    for (const pat of regex) {
        if (new RegExp(pat, "i").test(docText)) {
            regexHits.push(pat);
        }
    }

    const totalHits = [...allowedHits, ...regexHits];
    const passed = !must_be_present || totalHits.length > 0;

    return {
        passed,
        hits: totalHits,
        details: passed ? `Authority Found: ${totalHits.join(", ")}` : "No parameters matched issuing authority."
    };
}

function runLogicalRules(rules) {
    if (Array.isArray(rules.logical_rules)) {
        return rules.logical_rules.join("\n    - ");
    }
    return "None";
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

    const logicalRulesText = runLogicalRules(rules);

    const prompt = `
    You are a Super-Intelligent Document Verification Engine.
    
    TASK: Verify if the User Input is an EXACT MATCH to the Document Content AND if Logical Rules are satisfied.

    DOCUMENT CONTEXT:
    Type: ${rules ? rules.document_name : documentType}
    
    INPUT DATA:
    ${JSON.stringify(userInput, null, 2)}

    MATCH ANALYSIS:
    ${JSON.stringify(matches, null, 2)}
    
    AUTHENTICITY & AUTHORITY CHECK:
    Authenticity Markers: ${JSON.stringify(ruleVerificationResult.authenticity || {}, null, 2)}
    Issuing Authority: ${JSON.stringify(ruleVerificationResult.authority || {}, null, 2)}

    LOGICAL RULES TO ENFORCE:
    - ${logicalRulesText}

    PRE-COMPUTED VALIDATION ISSUES:
    ${issues.length > 0 ? JSON.stringify(issues) : "NONE (Code confirmed basic strict match)"}

    [PRIORITY RULES]
    1. **STRICT FIELDS**: If "PRE-COMPUTED VALIDATION ISSUES" contains errors, YOU MUST FAIL the document. Do NOT override these with PASS.
    2. **NO PLACEHOLDERS**: Your summary must contain ACTUAL values (e.g. "Alpha Tech Park"), NOT placeholders like "[PROJECT_NAME]".
    3. **DATA EXTRACTION**: Always fill "document_data" with detected info, even if verdict is FAIL.

    [EXAMPLES]
    If PASS:
    {
      "verdict": "PASS",
      "summary": "Your document is valid because the OCR text contains '[PROJECT_NAME]' as Project Name and '[ID_NUMBER]' as Consent Number which matches your input. Issued on [DATE].",
      "document_data": { "name": "[NAME]", "id_number": "[ID]", "expiry_date": "[EXPIRY]" }
    }
    If FAIL:
    {
      "verdict": "FAIL",
      "summary": "This document belongs to '[NAME_IN_OCR]' with ID '[ID_IN_OCR]'. Your document and applications details do not matched because the [FIELD] in OCR '[VALUE_IN_OCR]' does not match your input '[VALUE_IN_INPUT]'.",
      "document_data": { "name": "[NAME_IN_OCR]", "id_number": "[ID_IN_OCR]" }
    }

    [SUMMARY FORMAT]
    - If PASSED: Summarize the document and state 'Your document is valid because [Details]'. List detected entities like names, IDs, and dates.
    - If FAILED: Honestly describe the document content, then state 'Your document and applications details do not matched' and explain the specific mismatch found.
    - NEVER use placeholders like [PROJECT_NAME] or [VALUE_IN_OCR] in your final summary. Replace them with ACTUAL text from the OCR or User Input.
    - NEVER mention 'keywords' or 'matching keywords'.

    Output JSON Format:
    {
      "verdict": "PASS" | "FAIL",
      "risk_score": 0-100,
      "confidence": 0-100,
      "summary": "String explanation (must be specific to this document, no placeholders)",
      "document_data": {
        "name": "string",
        "id_number": "string",
        "date": "string",
        "other_details": "string"
      }
    }
    `;

    const MAX_RETRIES = 3;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
        try {
            console.log(`🤖 Consulting External AI (${MODEL_NAME}) [Attempt ${attempts + 1}]...`);
            const apiUrl = process.env.POINT;

            if (!apiUrl) throw new Error("Missing AI Service URL (POINT) in .env");

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    prompt: prompt,
                    stream: false
                })
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);

            const apiData = await response.json();
            const result = apiData.response || "";

            let cleanResult = result.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
            cleanResult = cleanResult.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

            const data = extractJSON(cleanResult);
            if (data) return data;

            console.warn("LLM returned invalid JSON, retrying...");
        } catch (err) {
            console.error(`AI Attempt ${attempts + 1} Failed:`, err.message);
            if (attempts === MAX_RETRIES - 1) break;
            await new Promise(res => setTimeout(res, 1000 * (attempts + 1))); // Exponentialish backoff
        }
        attempts++;
    }

    return { verdict: "MANUAL_REVIEW", summary: "AI Service Unreachable or Malformed Output after retries.", risk_score: 100 };
}



/* ---------------- MAIN SERVICE ---------------- */

async function verify(docText, userInput, documentType) {
    console.log("--- START VERIFICATION ---");
    console.log("Document Type:", documentType);
    console.log("Document Type (Hex):", Buffer.from(documentType).toString('hex'));

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

    // 3. Authenticity & Authority
    const authenticity = rules ? runAuthenticityCheck(docText, rules) : { score: 0, hits: [], passed: true, missing_required: [] };
    const authority = rules ? runIssuingAuthorityCheck(docText, rules) : { passed: true, hits: [] };

    let finalDecision;
    console.log("DECISION: Calling AI...");
    finalDecision = await aiLogicalCheckAndDecision({
        docText,
        userInput,
        issues: fieldIssues,
        matches: fieldMatches,
        ruleVerificationResult: { keywordGate, structural, authenticity, authority },
        rules,
        documentType
    });

    // If Authenticity failed but AI passed, maybe downgrade?
    if (rules && !authenticity.passed && finalDecision.verdict === "PASS") {
        finalDecision.summary += ` [WARNING: Missing Authenticity Markers: ${authenticity.missing_required.join(", ")}]`;
        finalDecision.risk_score = Math.max(finalDecision.risk_score || 0, 50);
    }

    console.log("AI Result:", JSON.stringify(finalDecision));

    // Standardize Verdict to PASS/FAIL if AI returns ACCEPT/REJECT or puts summary in verdict
    if (typeof finalDecision.verdict === 'string' &&
        (finalDecision.verdict.toLowerCase().includes("your document is") ||
            finalDecision.verdict.toLowerCase().includes("applications details do not matched"))) {
        const tempVerdict = finalDecision.verdict;
        finalDecision.verdict = tempVerdict.toLowerCase().includes("valid") ? "PASS" : "FAIL";
        // If summary is generic or too short, replace it with the descriptive text from verdict
        if (!finalDecision.summary || finalDecision.summary.length < 50) {
            finalDecision.summary = tempVerdict;
        }
    }

    if (finalDecision.verdict === "REJECT") finalDecision.verdict = "FAIL";

    // 4. Universal Extraction & Dynamic Summary
    const documentData = extractDocumentFields(docText);

    let authenticityWarning = "";
    if (rules && !authenticity.passed) {
        authenticityWarning = `[WARNING: Missing Authenticity Markers: ${authenticity.missing_required.join(", ")}]`;
    }

    // 4. Final Summary Construction
    // Priority: 1. AI Reasoning, 2. Dynamic Summary (fallback)
    const dynamicSummary = buildDynamicSummary(finalDecision.verdict, documentData, fieldIssues, authenticityWarning);

    // Use AI summary if it's substantial (e.g., > 40 chars), otherwise fallback to dynamic summary
    const aiSummary = finalDecision.summary || "";
    const isAiSummaryValid = aiSummary.length > 40 && !aiSummary.includes("AI Service Unreachable");

    if (isAiSummaryValid) {
        console.log("Using AI-generated Reasoning for final summary.");
        // Append authenticity warning if needed since AI might miss it
        if (authenticityWarning && !aiSummary.includes(authenticityWarning)) {
            finalDecision.summary = aiSummary.trim() + " " + authenticityWarning;
        } else {
            finalDecision.summary = aiSummary;
        }
    } else {
        console.log("Using Codified Dynamic Summary (AI summary was missing or too short).");
        finalDecision.summary = dynamicSummary;
    }
    finalDecision.document_data = documentData;

    console.log("Final Decision Object:", JSON.stringify(finalDecision));

    const finalResponse = {
        status: finalDecision.verdict,
        document_code: rules ? rules.document_code : "UNKNOWN",
        verdict: finalDecision,
        verification_log: {
            keyword_gate: keywordGate,
            structural_check: structural,
            field_validation_issues: fieldIssues,
            authenticity_check: authenticity,
            authority_check: authority,
            extracted_text: docText
        }
    };

    console.log("Final Response Keys:", Object.keys(finalResponse));
    return finalResponse;
}

module.exports = { verify };
