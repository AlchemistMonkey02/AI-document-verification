const fs = require("fs");
const path = require("path");
const runCrossChecks = require("./crossCheckService");
const kru2uni = require("@anthro-ai/krutidev-unicode");

// Configuration
const MODEL_NAME = "qwen3:4b";
const RULES_DIR = path.join(__dirname, "../rules");

/* ---------------- HELPERS ---------------- */

function detectAndConvertKrutiDev(docText) {
    if (!docText) return docText;
    
    // If docText already has Devanagari characters, it is already Unicode Hindi. Do NOT convert with kru2uni.
    const devanagariCount = (docText.match(/[\u0900-\u097F]/g) || []).length;
    if (devanagariCount > 5) {
        return docText;
    }

    try {
        const converted = kru2uni(docText);
        
        // Gather Devanagari keywords from rules to see if converted text hits them
        const allRules = loadAllRules();
        const allKeywords = [];
        for (const rule of allRules) {
            if (rule.identification) {
                if (Array.isArray(rule.identification.primary_keywords)) {
                    allKeywords.push(...rule.identification.primary_keywords);
                }
                if (Array.isArray(rule.identification.secondary_keywords)) {
                    allKeywords.push(...rule.identification.secondary_keywords);
                }
            }
        }
        
        // Standard Hindi words commonly found in documents
        const commonHindiWords = ["सरकार", "विभाग", "दिनांक", "कार्यालय", "महोदय", "जिला", "ब्लॉक", "आदेश", "प्रशिक्षण", "उपस्थिति", "हस्ताक्षर", "नाम", "विवरण", "स्वीकृति"];
        const searchWords = [...new Set([...allKeywords, ...commonHindiWords])].filter(w => /[\u0900-\u097F]/.test(w));
        
        // Count hits in converted text
        const lowerConverted = converted.toLowerCase();
        const hits = searchWords.filter(word => lowerConverted.includes(word.toLowerCase()));
        
        if (hits.length >= 1) {
            console.log(`[KrutiDev Detection] Converted text matched Hindi keywords: ${hits.slice(0, 5).join(", ")}. Converting document to Unicode Hindi.`);
            return converted;
        }
    } catch (err) {
        console.error("Error during KrutiDev detection/conversion:", err.message);
    }
    return docText;
}

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
    const workOrderKeywords = [
        "work order",
        "कार्यादेश",
        "कार्य आदेश"
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
    if (!rules || !rules.mandatory_sections || rules.mandatory_sections.length === 0) return { passed: true, missing: [] };
    
    const lowerDocText = docText.toLowerCase();
    const missingSections = [];

    const synonyms = {
        "date": ["date", "दिनांक", "तिथि", "वर्ष", "समय", "day", "month", "year", "202", "201", "200", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "सत्र", "session", "training", "attendance"],
        "name": ["name", "नाम", "participant", "प्रतिभागी", "s.no", "sno", "sr.no", "sr", "no.", "क्र", "सं", "विवरण"],
        "signature": ["signature", "हस्ताक्षर", "दस्तखत", "मोहर", "अंगूठा", "sign", "sig", "sheet", "record", "list", "building", "rajasthan", "training", "attendance", "p", "a"],
        "work name": ["work name", "कार्य का नाम", "कार्य नाम", "विषय", "training", "प्रशिक्षण"],
        "completion date": ["completion date", "पूर्णता तिथि", "समाप्ति तिथि", "दिनांक"],
        "authority signature": ["authority signature", "हस्ताक्षर", "सत्यापन अधिकारी", "मोहर"],
        "order number": ["order number", "क्रमांक", "आदेश क्रमांक", "पत्र क्रमांक"],
        "amount": ["amount", "राशि", "स्वीकृत राशि", "लागत"],
        "authority": ["authority", "अधिकारी", "प्राधिकारी", "विभाग"]
    };

    for (const sec of rules.mandatory_sections) {
        const secLower = sec.toLowerCase();
        const alternatives = synonyms[secLower] || [secLower];
        const found = alternatives.some(alt => lowerDocText.includes(alt.toLowerCase()));
        if (!found) {
            missingSections.push(sec);
        }
    }
    
    return {
        passed: missingSections.length === 0,
        missing: missingSections,
        details: missingSections.length === 0 ? "All mandatory sections present" : `Missing mandatory sections: ${missingSections.join(", ")}`
    };
}

const FIELD_SYNONYMS = {
    "rgsa": ["rgsa", "r.g.s.a", "राष्ट्रीय ग्राम स्वराज अभियान", "rashtriya gram swaraj abhiyan", "gram swaraj"],
    "dholpur": ["dholpur", "धौलपुर", "जिला धौलपुर"],
    "jhalawar": ["jhalawar", "झालावाड़", "झालादाड", "आलाबाड़", "जिला परिषद,झालावाड़", "जिला झालावाड़"],
    "baran": ["baran", "बारां", "जिला बारां"],
    "karauli": ["karauli", "करौली", "जिला करौली"],
    "tot": ["tot", "t.o.t", "training of trainers", "master trainers", "मास्टर ट्रेनर्स", "प्रशिक्षण"],
    "own source revenue": ["own source revenue", "osr", "स्वयं के आय स्रोत", "आय स्रोतों", "आय स्रोत"],
    "block level": ["block level", "ब्लॉक स्तर", "ब्लॉक स्तरीय", "ब्लॉक"]
};

function checkValueInText(docText, userValue, strategy = "FLEXIBLE") {
    if (!userValue || !docText) return false;
    const strVal = String(userValue).trim();
    if (!strVal) return true;

    const norm = (str) => String(str).replace(/[^a-zA-Z0-9\u0900-\u097F]/g, "").toLowerCase();
    const normDoc = norm(docText);
    const normVal = norm(strVal);

    // 1. Direct normalized match
    if (normVal && normDoc.includes(normVal)) {
        return true;
    }

    // 2. Check synonyms & Hindi/English translations
    const lowerVal = strVal.toLowerCase().trim();
    for (const [key, synList] of Object.entries(FIELD_SYNONYMS)) {
        if (lowerVal.includes(key)) {
            for (const syn of synList) {
                if (normDoc.includes(norm(syn))) {
                    return true;
                }
            }
        }
    }

    // 3. String similarity / Fuzzy matching using textComparator
    try {
        const compareText = require("./textComparator");
        const comp = compareText(docText, strVal);
        if (comp && (comp.score >= 50 || comp.raw_similarity >= 0.4)) {
            return true;
        }
    } catch (e) {}

    // 4. Token overlap matching for multi-word or compound user claims (e.g. topic/eventName)
    const words = strVal.split(/[\s,()/\\-]+/).map(w => norm(w)).filter(w => w.length >= 2);
    if (words.length > 0) {
        let matchCount = 0;
        for (const word of words) {
            let wordMatched = normDoc.includes(word);
            if (!wordMatched && FIELD_SYNONYMS[word]) {
                wordMatched = FIELD_SYNONYMS[word].some(syn => normDoc.includes(norm(syn)));
            }
            if (wordMatched) matchCount++;
        }
        const matchRatio = matchCount / words.length;
        if (matchRatio >= 0.3 || (words.length >= 3 && matchCount >= 2) || (words.length <= 2 && matchCount >= 1)) {
            return true;
        }
    }

    return false;
}

function runFieldValidation(docText, userInput, rules) {
    const issues = [];
    const matches = [];
    const inputData = userInput || {};
    const definedFields = (rules && rules.fields) ? rules.fields : {};

    for (const [field, rule] of Object.entries(definedFields)) {
        const userValue = inputData[field];

        if (rule.expected_value) {
            const expNorm = String(rule.expected_value).toLowerCase().replace(/\s+/g, " ");
            const docNorm = (docText || "").toLowerCase().replace(/\s+/g, " ");
            if (!docNorm.includes(expNorm)) {
                issues.push(`Expected value '${rule.expected_value}' for field '${field}' was not found in document.`);
            }
        }

        if (rule.required && !userValue && !rule.expected_value) {
            issues.push(`Required field '${field}' was not provided in input data.`);
            continue;
        }

        if (!userValue) continue;

        if (rule.regex) {
            const regex = new RegExp(rule.regex);
            if (!regex.test(userValue)) {
                issues.push(`Field '${field}': Value '${userValue}' does not match format ${rule.regex}`);
            }
        }

        const strategy = rule.match_strategy || "FLEXIBLE";
        const isMatch = checkValueInText(docText, userValue, strategy);
        if (!isMatch) {
            issues.push(`Field '${field}' mismatch: '${userValue}' not found in document.`);
        } else {
            matches.push({ field, value: userValue, strategy });
        }
    }

    const ignoredMetaFields = [
        "keywords", "keyword", "inputKeywords", "required_keywords", "input_keywords",
        "expected_keyword", "expected_keywords", "documentType", "document_type", "file"
    ];

    for (const [field, userValue] of Object.entries(inputData)) {
        if (definedFields[field] || !userValue || ignoredMetaFields.includes(field)) continue;

        const isMatch = checkValueInText(docText, userValue, "FLEXIBLE");
        if (!isMatch) {
            issues.push(`Field '${field}' mismatch: '${userValue}' not found in document.`);
        } else {
            matches.push({ field, value: userValue, strategy: "USER_CLAIM" });
        }
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
    
    DOCUMENT CONTENT (EXTRACTED TEXT):
    ${docText}
    
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
                timeout: 300000 // 5 minutes timeout to handle slow CPU thinking models
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

    docText = detectAndConvertKrutiDev(docText);

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

    const isCert = isCompletionCertificate(docText, rules);
    const isAtt = isAttendanceSheet(docText, rules);
    const isWO = isWorkOrder(docText, rules);

    const failureReasons = [];

    if (!keywordGate.passed) {
        failureReasons.push("Keyword identification failed or required primary keywords missing.");
    }

    const activeCode = rules ? rules.document_code : resolvedCode;
    if (activeCode === "DOC_WORK_ORDER" && !isWO) {
        failureReasons.push("Document does not contain required Work Order identification terms.");
    } else if (activeCode === "DOC_ATTENDANCE" && !isAtt) {
        failureReasons.push("Document does not contain required Attendance sheet identification terms.");
    } else if (activeCode === "DOC_COMPLETION_CERT" && !isCert) {
        failureReasons.push("Document does not contain required Completion Certificate identification terms.");
    }

    if (!structural.passed) {
        failureReasons.push(`Missing mandatory sections: ${structural.missing ? structural.missing.join(", ") : "Unknown"}`);
    }

    if (!authority.passed) {
        failureReasons.push("Required issuing authority was not found in the document.");
    }

    if (!authenticity.passed) {
        failureReasons.push(`Missing required authenticity markers: ${authenticity.missing_required ? authenticity.missing_required.join(", ") : "Unknown"}`);
    }

    if (fieldIssues.length > 0) {
        failureReasons.push(`Field validation issues: ${fieldIssues.join("; ")}`);
    }

    let finalDecision;

    if (failureReasons.length > 0) {
        console.log("DECISION: Verification Failed ->", failureReasons.join(" | "));
        delete keywordGate.hits;
        delete keywordGate.missing;
        keywordGate.details = "Uploaded document is fake or incorrect.";

        finalDecision = {
            verdict: "FAIL",
            risk_score: 100,
            confidence: 100,
            summary: `Uploaded document is fake or incorrect. Reasons: ${failureReasons.join(" | ")}`
        };
    } else {
        console.log("DECISION: All Rules Passed. Verification SUCCESS.");
        finalDecision = {
            verdict: "PASS",
            risk_score: 0,
            confidence: 100,
            summary: "Document successfully matched rule criteria, keywords, mandatory sections, authority, and field validation."
        };
    }

    if (finalDecision.verdict === "ACCEPT") finalDecision.verdict = "PASS";
    if (finalDecision.verdict === "REJECT") finalDecision.verdict = "FAIL";

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
    docText = detectAndConvertKrutiDev(docText);
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
    docText = detectAndConvertKrutiDev(docText);
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
    docText = detectAndConvertKrutiDev(docText);
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
