function clean(value) {
    return value.replace(/\s+/g, " ").trim();
}

function tryMatch(text, patterns) {
    for (const regex of patterns) {
        const match = text.match(regex);
        if (match) {
            // Pick the last capture group which is usually the value
            const filtered = match.slice(1).filter(v => v !== undefined);
            return clean(filtered[filtered.length - 1] || "");
        }
    }
    return null;
}

function extractDocumentFields(docText) {
    const text = docText.replace(/\s+/g, " ");
    const data = {};

    const fields = {
        aadhaar_number: [
            /\b(\d{4}\s?\d{4}\s?\d{4})\b/
        ],
        pan_number: [
            /\b([A-Z]{5}[0-9]{4}[A-Z])\b/
        ],
        passport_number: [
            /\b([A-Z][0-9]{7})\b/
        ],
        gst_number: [
            /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/
        ],
        date_of_birth: [
            /(?:dob|date\s*of\s*birth)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
        ],
        issue_date: [
            /(?:issue\s*date|issued\s*on|date\s*of\s*issuance)\b.*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
        ],
        expiry_date: [
            /(?:expiry|valid\s*till|validity|valid\s*up\s*(?:to|10))\b.*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|[0-9]{8,10})/i
        ],
        valid_from: [
            /valid\s*from\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
        ],
        company_name: [
            /(?:company|project)\s*name\s*[:\-]?\s*([a-z0-9\s]+?)(?=\s+(?:PROJECT|ADDRESS|NOC|DATE|VALID|APPLICATION|PINCODE|STATE|DISTRICT|TOWN|CATEGORY|WATER)\b|$)/i
        ],
        document_number: [
            /(?:certificate|license|consent|noc)\s*(?:number|no)\s*[:\-]?\s*([A-Z0-9\-\/ ]+?)(?=\s+(?:DATE|VALID|PROJECT|ADDRESS|APPLICATION|PINCODE|STATE|DISTRICT|TOWN|CATEGORY|WATER)\b|$)/i,
            /ndgno\s*([A-Z0-9\-\/]+)/i
        ],
        email: [
            /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i
        ],
        phone: [
            /\b(\+91\s?\d{10})\b/,
            /\b([6-9]\d{9})\b/
        ],
        address: [
            /address\s*[:\-]?\s*([a-z0-9,\-\s\.]+?)(?=\s+(?:PROJECT|ADDRESS|NOC|DATE|VALID|APPLICATION|PINCODE|STATE|DISTRICT|TOWN|CATEGORY|WATER)\b|$)/i
        ],
        authority: [
            /((?:central|state)\s*ground\s*water\s*authority)/i,
            /(government\s*of\s*[a-z\s]+?)(?=\s*name:|$)/i,
            /(ministry\s*of\s*[a-z\s]+)/i,
            /(uidai)/i
        ]
    };

    for (const [field, patterns] of Object.entries(fields)) {
        const value = tryMatch(text, patterns);
        if (value) {
            data[field] = value;
        }
    }

    return data;
}

function formatKey(key) {
    return key
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = {
    extractDocumentFields,
    formatKey
};
