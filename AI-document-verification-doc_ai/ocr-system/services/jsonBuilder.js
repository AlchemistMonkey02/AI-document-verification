function buildJSON(text) {
    if (!text) {
        return {
            raw_text: "",
            lines: [],
            word_count: 0,
            extracted_at: new Date()
        };
    }
    return {
        raw_text: text.trim(),
        lines: text.split("\n").map(l => l.trim()).filter(Boolean),
        word_count: text.trim().split(/\s+/).length,
        extracted_at: new Date()
    };
}

module.exports = buildJSON;
