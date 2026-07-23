const fs = require("fs");
const path = require("path");
const runCrossChecks = require("./crossCheckService");

// Configuration
const MODEL_NAME = "qwen3:4b";
const RULES_DIR = path.join(__dirname, "../rules");

/* ---------------- HELPERS ---------------- */

function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
}

function resolveDocumentCode(slugOrCode) {
    if (!slugOrCode) return null;
    const clean = slugOrCode.trim().toLowerCase();
    
    const slugMap = {
        "attendance": "DOC_ATTENDANCE",
        "completion-certificate": "DOC_COMPLETION_CERT",
        "completion": "DOC_COMPLETION_CERT",
        "work-order": "DOC_WORK_ORDER",
        "training-report": "TRAINING_REPORT",
        "orientation-training": "ORIENTATION_TRAINING",
        "pdi-registration": "PDI_REGISTRATION",
        "bpdp": "PRIORITIZATION_BPDP",
        "prioritization-bpdp": "PRIORITIZATION_BPDP",
        "gpdp": "PRIORITIZATION_GPDP",
        "prioritization-gpdp": "PRIORITIZATION_GPDP",
        "empower-wer": "EMPOWER_WER",
        "e-service-delivery": "E_SERVICE_DELIVERY",
        "thematic-sankalp": "THEMATIC_SANKALP",
        "tot-osr": "TOT_OSR",
        "tot-wer": "TOT_WER",
        "training-pai-npa": "TRAINING_PAI_NPA",
        "training-sathin": "TRAINING_SATHIN",
        "vdo-training": "VDO_TRAINING",
        "aadhaar": "DOC_AADHAAR",
        "pan": "DOC_PAN_COMPANY",
        "ec": "DOC_EC_CTE",
        "cte": "DOC_EC_CTE"
    };

    if (slugMap[clean]) return slugMap[clean];

    let formatted = slugOrCode.trim().replace(/-/g, "_").toUpperCase();
    if (!formatted.startsWith("DOC_") && ["ATTENDANCE", "COMPLETION_CERT", "WORK_ORDER", "EC_CTE", "AADHAAR", "PAN_COMPANY"].includes(formatted)) {
        formatted = "DOC_" + formatted;
    }

    return formatted;
}

function loadAllRules() {
    const rules = [];
    try {
        if (fs.existsSync(RULES_DIR)) {
            const files = fs.readdirSync(RULES_DIR);
            for (const file of files) {
                if (file.endsWith('.rules.json')) {
                    try {
                        const content = fs.readFileSync(path.join(RULES_DIR, file), 'utf8');
                        const rule = JSON.parse(content);
                        const kws = rule.identification ? (rule.identification.primary_keywords || []) : [];
                        const minHits = rule.identification ? (rule.identification.min_keyword_hits || 0) : 0;
                        if (kws.length > 0 || minHits > 0) {
                            rules.push(rule);
                        }
                    } catch (e) {
                        console.error(`Error parsing rule file ${file}:`, e.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Error reading rules directory:", err.message);
    }
    return rules;
}

function loadRules(documentType) {
    if (!documentType) return null;

    const resolvedCode = resolveDocumentCode(documentType);
    let filename = `${resolvedCode}.rules.json`;

    try {
        let rulesPath = path.join(RULES_DIR, filename);
        if (fs.existsSync(rulesPath)) {
            return JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
        }

        const allRules = loadAllRules();
        const found = allRules.find(r => 
            (r.document_code && r.document_code.toUpperCase() === resolvedCode.toUpperCase()) ||
            (r.document_name && r.document_name.toUpperCase() === resolvedCode.toUpperCase())
        );
        if (found) return found;

    } catch (err) {
        console.error(`Error loading rules for ${documentType}:`, err.message);
    }
    return null;
}

function autoDetectDocumentType(docText) {
    const allRules = loadAllRules();
    let bestMatch = null;
    let maxHits = 0;
    let bestGate = null;

    for (const rule of allRules) {
        const gateResult = runKeywordGate(docText, rule);
        if (gateResult.passed) {
            const hitCount = (gateResult.hits || []).length;
            if (hitCount > maxHits) {
                maxHits = hitCount;
                bestMatch = rule;
                bestGate = gateResult;
            }
        }
    }

    if (bestMatch) {
        return { matchedRule: bestMatch, keywordGate: bestGate };
    }
    return null;
}

function isCompletionCertificate(docText, rules = null) {
    if (rules && (rules.document_code === "DOC_COMPLETION_CERT" || (rules.identification && (rules.identification.primary_keywords || []).includes("प्रशिक्षण पूर्णता प्रमाण पत्र")))) {
        return true;
    }
    const certKeywords = [
        "completion certificate",
        "certificate of completion",
        "कार्य पूर्णता प्रमाण पत्र",
        "प्रशिक्षण पूर्णता प्रमाण पत्र",
        "पूर्णता प्रमाण पत्र"
    ];
    const lower = (docText || "").toLowerCase();
    return certKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

function isAttendanceSheet(docText, rules = null) {
    if (rules && rules.document_code === "DOC_ATTENDANCE") {
        return true;
    }
    const attendanceKeywords = [
        "attendance",
        "उपस्थिति",
        "muster roll",
        "attendance sheet"
    ];
    const lower = (docText || "").toLowerCase();
    return attendanceKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

function isWorkOrder(docText, rules = null) {
    if (rules && rules.document_code === "DOC_WORK_ORDER") {
        return true;
    }
    const workOrderKeywords = [
        "work order",
        "कार्यादेश",
        "कार्य आदेश",
        "sanction",
        "स्वीकृति"
    ];
    const lower = (docText || "").toLowerCase();
    return workOrderKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/* ---------------- LOGIC ---------------- */

function runKeywordGate(docText, rules) {
    if (!rules || !rules.identification) return { passed: false, hits: [], missing: [], details: "No identification keywords defined in template." };

    const { primary_keywords = [], secondary_keywords = [], min_keyword_hits = 1 } = rules.identification;
    const lowerDocText = docText.toLowerCase();

    const checkKeywords = (kws) => kws.filter(kw => lowerDocText.includes(kw.toLowerCase()));

    const primaryHits = checkKeywords(primary_keywords);
    const secondaryHits = checkKeywords(secondary_keywords);
    const totalHits = primaryHits.length + secondaryHits.length;

    const missingPrimary = primary_keywords.filter(kw => !lowerDocText.includes(kw.toLowerCase()));

    let passed = totalHits >= min_keyword_hits;

    if (primary_keywords.length > 0 && primaryHits.length === 0 && min_keyword_hits > 0) {
        passed = false;
    }

    return {
        passed,
        hits: [...primaryHits, ...secondaryHits],
        missing: missingPrimary.concat(secondary_keywords.filter(kw => !lowerDocText.includes(kw.toLowerCase()))),
        details: `Found ${totalHits} keywords (${primaryHits.length} primary, ${secondaryHits.length} secondary). Min required: ${min_keyword_hits}`
    };
}

function runStructuralValidation(docText, rules) {
    if (!rules || !rules.mandatory_sections) return { passed: true, missing: [] };
    
    const lowerDocText = docText.toLowerCase();
    const missingSections = rules.mandatory_sections.filter(sec => !lowerDocText.includes(sec.toLowerCase()));
    
    return {
        passed: missingSections.length === 0,
        missing: missingSections,
        details: missingSections.length === 0 ? "All mandatory sections present" : `Missing mandatory sections: ${missingSections.join(", ")}`
    };
}

function runFieldValidation(docText, userInput, rules) {
    const issues = [];
    const matches = [];
    if (!rules || !rules.fields || !userInput) return { issues, matches };

    for (const [field, rule] of Object.entries(rules.fields)) {
        const userValue = userInput[field];

        if (rule.required && !userValue) {
            continue;
        }

        if (!userValue) continue;

        if (rule.regex) {
            const regex = new RegExp(rule.regex);
            if (!regex.test(userValue)) {
                issues.push(`Field '${field}': Value '${userValue}' does not match format ${rule.regex}`);
            }
        }

        if (rule.match_strategy === "STRICT") {
            const hasDigits = /\d/.test(userValue);
            const norm = (str) => String(str).replace(/[^a-zA-Z0-9\u0900-\u097F]/g, "").toLowerCase();

            if (hasDigits) {
                const normalizedDoc = norm(docText);
                const normalizedUserVal = norm(userValue);
                if (!normalizedDoc.includes(normalizedUserVal)) {
                    issues.push(`Field '${field}' mismatch: '${userValue}' not found in document (STRICT).`);
                }
            } else {
                const safeUserVal = userValue.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${safeUserVal}\\b`, "i");
                if (!regex.test(docText)) {
                    const spaceNormDoc = docText.replace(/\s+/g, "");
                    const spaceNormVal = userValue.replace(/\s+/g, "");
                    if (!new RegExp(spaceNormVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i").test(spaceNormDoc)) {
                        issues.push(`Field '${field}' mismatch: '${userValue}' not found in document (STRICT).`);
                    }
                }
            }
        } else if (rule.match_strategy === "FLEXIBLE") {
            const norm = (str) => String(str).replace(/[^a-zA-Z0-9\u0900-\u097F]/g, "").toLowerCase();
            if (!norm(docText).includes(norm(userValue))) {
                issues.push(`Field '${field}' mismatch: '${userValue}' not found (FLEXIBLE).`);
            }
        }

        matches.push({ field, value: userValue, strategy: rule.match_strategy });
    }
    return { issues, matches };
}

function runAuthenticityCheck(docText, rules) {
    if (!rules || !rules.authenticity) return { score: 0, hits: [], passed: true, missing_required: [] };

    const { required = [], optional = [] } = rules.authenticity;
    const allMarkers = [...required, ...optional];

    if (allMarkers.length === 0) return { score: 0, hits: [], passed: true, missing_required: [] };

    const lowerDocText = docText.toLowerCase();
    const hits = allMarkers.filter(marker => lowerDocText.includes(marker.replace(/_/g, " ").toLowerCase()));

    const missingRequired = required.filter(marker => !lowerDocText.includes(marker.replace(/_/g, " ").toLowerCase()));
    const passed = missingRequired.length === 0;

    return {
        score: hits.length,
        hits,
        passed,
        missing_required: missingRequired
    };
}

function runIssuingAuthorityCheck(docText, rules) {
    if (!rules || !rules.issuing_authority) return { passed: true, hits: [] };

    const { allowed = [], regex = [], must_be_present = false } = rules.issuing_authority;

    if (!must_be_present && allowed.length === 0 && regex.length === 0) {
        return { passed: true, hits: [] };
    }

    const lowerDocText = docText.toLowerCase();
    const allowedHits = allowed.filter(auth => lowerDocText.includes(auth.toLowerCase()));

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
    if (rules && Array.isArray(rules.logical_rules)) {
        return rules.logical_rules.join("\n    - ");
    }
    return "None";
}

function extractJSON(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (e) {}
        }

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
    3. **AUTHORITY**: If Issuing Authority is required but missing -> FAIL/HIGH RISK.
    4. **CONTEXT**: Ensure matches are semantic.

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
            const { OpenAI } = require('openai');
            const client = new OpenAI({
                baseURL: 'https://ai.geoplanetsolution.in/v1',
                apiKey: 'ollama',
            });

            const response = await client.chat.completions.create({
                model: MODEL_NAME,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1
            });

            const result = response.choices[0].message.content || "";
            
            let cleanResult = result.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
            cleanResult = cleanResult.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

            const data = extractJSON(cleanResult);
            if (data) return data;

            console.warn("LLM returned invalid JSON, retrying...");
        } catch (err) {
            console.error(`AI Attempt ${attempts + 1} Failed:`, err.message);
            if (attempts === MAX_RETRIES - 1) break;
            await new Promise(res => setTimeout(res, 1000 * (attempts + 1)));
        }
        attempts++;
    }

    return { verdict: "MANUAL_REVIEW", summary: "AI Service Unreachable or Malformed Output after retries.", risk_score: 100 };
}

/* ---------------- MAIN SERVICE ---------------- */

async function verify(docText, userInput = {}, documentType = "AUTO") {
    console.log("--- START VERIFICATION ---");
    console.log("Input Document Type:", documentType);

    const resolvedCode = resolveDocumentCode(documentType);
    let rules = null;
    let keywordGate = { passed: false, hits: [], missing: [], details: "Not evaluated" };

    if (!documentType || documentType.toUpperCase() === "AUTO" || documentType.toUpperCase() === "UNKNOWN") {
        console.log("Auto-detecting document template via keyword gate...");
        const autoResult = autoDetectDocumentType(docText);
        if (autoResult) {
            rules = autoResult.matchedRule;
            keywordGate = autoResult.keywordGate;
            console.log(`Auto-detected document type: ${rules.document_code}`);
        } else {
            console.log("DECISION: Auto-detection failed. Uploaded document is fake or unrecognized.");
            return {
                status: "FAIL",
                document_code: "UNKNOWN",
                is_completion_certificate: false,
                is_attendance_sheet: false,
                is_work_order: false,
                verdict: {
                    verdict: "FAIL",
                    risk_score: 100,
                    confidence: 100,
                    summary: "Uploaded document is fake or incorrect."
                },
                verification_log: {
                    keyword_gate: {
                        passed: false,
                        details: "Uploaded document is fake or incorrect."
                    }
                }
            };
        }
    } else {
        rules = loadRules(resolvedCode);
    }

    console.log("Rules Loaded:", rules ? `YES (${rules.document_code})` : "NO");

    if (!rules) {
        console.log("DECISION: No Rules Found for specified document type.");
        return {
            status: "FAIL",
            document_code: resolvedCode || "UNKNOWN",
            is_completion_certificate: false,
            is_attendance_sheet: false,
            is_work_order: false,
            verdict: {
                verdict: "FAIL",
                risk_score: 100,
                confidence: 0,
                summary: "Uploaded document is fake or incorrect."
            },
            verification_log: {}
        };
    }

    if (!keywordGate.passed && keywordGate.details === "Not evaluated") {
        keywordGate = runKeywordGate(docText, rules);
    }
    console.log("Keyword Gate Passed:", keywordGate.passed);

    const structural = runStructuralValidation(docText, rules);
    const fieldValidation = runFieldValidation(docText, userInput, rules);
    const fieldIssues = fieldValidation.issues;
    const fieldMatches = fieldValidation.matches;

    const crossCheckIssuesContainer = { cross_checks: [] };
    runCrossChecks(docText, rules, crossCheckIssuesContainer);
    if (crossCheckIssuesContainer.cross_checks.length > 0) {
        crossCheckIssuesContainer.cross_checks.forEach(issue => {
            fieldIssues.push(`[${issue.code}] ${issue.message}`);
        });
    }

    console.log("Field Issues Count:", fieldIssues.length);

    const authenticity = runAuthenticityCheck(docText, rules);
    const authority = runIssuingAuthorityCheck(docText, rules);

    let finalDecision;

    if (!keywordGate.passed) {
        console.log("DECISION: Gate Failure (Keywords Missing)");
        
        delete keywordGate.hits;
        delete keywordGate.missing;
        keywordGate.details = "Uploaded document is fake or incorrect.";

        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: "Uploaded document is fake or incorrect."
        };
    }
    else if (!authority.passed) {
        console.log("DECISION: Authority Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: "Uploaded document is fake or incorrect."
        };
    }
    else if (fieldIssues.length > 0) {
        console.log("DECISION: Field Failure");
        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: "Uploaded document is fake or incorrect."
        };
    }
    else {
        const noLogicalRules = !rules.logical_rules || rules.logical_rules.length === 0;
        
        if (noLogicalRules) {
            console.log("DECISION: Fast-Track PASS (Skipping AI)");
            finalDecision = {
                verdict: "PASS",
                risk_score: 0,
                confidence: 100,
                summary: "Document successfully matched basic rule criteria and keywords. Verification passed."
            };
        } else {
            console.log("DECISION: Calling AI for logical check...");
            finalDecision = await aiLogicalCheckAndDecision({
                docText,
                userInput,
                issues: fieldIssues,
                matches: fieldMatches,
                ruleVerificationResult: { keywordGate, structural, authenticity, authority },
                rules,
                documentType: rules.document_code
            });

            if (!authenticity.passed && finalDecision.verdict === "PASS") {
                finalDecision.summary += ` [WARNING: Missing Authenticity Markers: ${authenticity.missing_required.join(", ")}]`;
                finalDecision.risk_score = Math.max(finalDecision.risk_score || 0, 50);
            }

            console.log("AI Result:", JSON.stringify(finalDecision));
        }
    }

    if (finalDecision.verdict === "ACCEPT") finalDecision.verdict = "PASS";
    if (finalDecision.verdict === "REJECT") finalDecision.verdict = "FAIL";

    const isCert = isCompletionCertificate(docText, rules);
    const isAtt = isAttendanceSheet(docText, rules);
    const isWO = isWorkOrder(docText, rules);

    return {
        status: finalDecision.verdict,
        document_code: rules.document_code,
        is_completion_certificate: isCert && finalDecision.verdict !== "FAIL",
        is_attendance_sheet: isAtt && finalDecision.verdict !== "FAIL",
        is_work_order: isWO && finalDecision.verdict !== "FAIL",
        verdict: finalDecision,
        verification_log: {
            keyword_gate: keywordGate,
            structural_check: structural,
            field_validation_issues: fieldIssues,
            authenticity_check: authenticity,
            authority_check: authority
        }
    };
}

async function verifyCompletionCertificate(docText, userInput = {}) {
    const certRule = loadRules("DOC_COMPLETION_CERT");
    const keywordGate = certRule ? runKeywordGate(docText, certRule) : { passed: false };
    const certMatch = isCompletionCertificate(docText, certRule);

    if (!certMatch || !keywordGate.passed) {
        return {
            status: "FAIL",
            is_completion_certificate: false,
            document_code: certRule ? certRule.document_code : "UNKNOWN",
            verdict: {
                verdict: "FAIL",
                risk_score: 100,
                confidence: 100,
                summary: "Uploaded document is fake or incorrect."
            },
            verification_log: {
                keyword_gate: keywordGate
            }
        };
    }

    const verificationResult = await verify(docText, userInput, "DOC_COMPLETION_CERT");
    verificationResult.is_completion_certificate = verificationResult.status !== "FAIL";
    return verificationResult;
}

async function verifyAttendance(docText, userInput = {}) {
    const attendanceRule = loadRules("DOC_ATTENDANCE");
    const keywordGate = attendanceRule ? runKeywordGate(docText, attendanceRule) : { passed: false };
    const attendanceMatch = isAttendanceSheet(docText, attendanceRule);

    if (!attendanceMatch || !keywordGate.passed) {
        return {
            status: "FAIL",
            is_attendance_sheet: false,
            document_code: attendanceRule ? attendanceRule.document_code : "UNKNOWN",
            verdict: {
                verdict: "FAIL",
                risk_score: 100,
                confidence: 100,
                summary: "Uploaded document is fake or incorrect."
            },
            verification_log: {
                keyword_gate: keywordGate
            }
        };
    }

    const verificationResult = await verify(docText, userInput, "DOC_ATTENDANCE");
    verificationResult.is_attendance_sheet = verificationResult.status !== "FAIL";
    return verificationResult;
}

async function verifyWorkOrder(docText, userInput = {}) {
    const workOrderRule = loadRules("DOC_WORK_ORDER");
    const keywordGate = workOrderRule ? runKeywordGate(docText, workOrderRule) : { passed: false };
    const workOrderMatch = isWorkOrder(docText, workOrderRule);

    if (!workOrderMatch || !keywordGate.passed) {
        return {
            status: "FAIL",
            is_work_order: false,
            document_code: workOrderRule ? workOrderRule.document_code : "UNKNOWN",
            verdict: {
                verdict: "FAIL",
                risk_score: 100,
                confidence: 100,
                summary: "Uploaded document is fake or incorrect."
            },
            verification_log: {
                keyword_gate: keywordGate
            }
        };
    }

    const verificationResult = await verify(docText, userInput, "DOC_WORK_ORDER");
    verificationResult.is_work_order = verificationResult.status !== "FAIL";
    return verificationResult;
}

module.exports = {
    verify,
    resolveDocumentCode,
    loadAllRules,
    loadRules,
    autoDetectDocumentType,
    runKeywordGate,
    isCompletionCertificate,
    verifyCompletionCertificate,
    isAttendanceSheet,
    verifyAttendance,
    isWorkOrder,
    verifyWorkOrder
};
