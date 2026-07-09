const fs = require("fs");
const path = require("path");
// const { execSync } = require("child_process"); // Removed for API usage


// Configuration
const MODEL_NAME = "qwen3:4b";
const RULES_DIR = path.join(__dirname, "../rules");

/* ---------------- HELPERS ---------------- */

function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
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
            // It's missing in input, but is it required? Yes.
            // However, if the user didn't provide it, we can't verify it.
            // Usually we skip if input is missing unless we are validating input completeness too.
            // Let's skip verification if user didn't provide it, but maybe log a warning?
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
        }
        // SEMANTIC is handled by AI later, so we just capture context here if found

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

    STEPS TO EXECUTE:
    1. **STRICT FIELDS**: If "PRE-COMPUTED VALIDATION ISSUES" has errors, YOU MUST FAIL.
    2. **LOGICAL CHECKS**: Check dates and cross-field logic from "LOGICAL RULES".
       - Example: "validity_period MUST COVER application_date".
       - If logic fails -> FAIL.
    3. **AUTHORITY**: If Issuing Authority is required but missing -> FAIL/HIGH RISK.
    4. **CONTEXT**: Ensure matches are semantic (e.g. Name matches name, not father's name).

    Output JSON:
    {
      "verdict": "PASS" | "FAIL",
      "risk_score": 0-100,
      "confidence": 0-100,
      "summary": "Explain the comparison, logical rule evaluation, and authenticity findings."
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

    // Critical Gate Failures
    if (rules && !keywordGate.passed) {
        console.log("DECISION: Gate Failure");
        
        // Remove keyword arrays so we don't leak information to users
        delete keywordGate.hits;
        delete keywordGate.missing;
        keywordGate.details = "Document verification failed. Invalid document type.";

        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: "Uploaded document is fake or incorrect. Please check and upload the correct document again. Document verification failed."
        };
    }
    else if (rules && !authority.passed) {
        console.log("DECISION: Authority Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: `Document failed Issuing Authority Check. Expected: ${rules.issuing_authority.allowed.join(" or ")}`
        };
    }
    // Field Validation Failure (Fail Fast)
    else if (fieldIssues.length > 0) {
        console.log("DECISION: Field Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: `Field Validation Failed. Verified issues: ${fieldIssues.join("; ")}`
        };
    }
    else {
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
            field_validation_issues: fieldIssues,
            authenticity_check: authenticity,
            authority_check: authority
        }
    };
}

module.exports = { verify };
