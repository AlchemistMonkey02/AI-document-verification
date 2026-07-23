/**
 * Normalizes text for consistent matching.
 * Handles:
 * - Unicode normalization (NFKD)
 * - Removing Hindi characters
 * - Removing special characters except those valid in IDs (: / -)
 * - Collapsing whitespace BUT preserving newlines
 * - Lowercasing
 */
function normalizeText(text = "") {
    if (!text) return "";
    return text
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9\u0900-\u097F:/\-\s@._]/g, " ") // keep alphanumeric + Hindi + common separators + email chars + newlines
        .replace(/[ \t\r]+/g, " ") // Collapse spaces/tabs to single space
        .replace(/\n\s*/g, "\n") // Clean up start of lines
        .replace(/\n+/g, "\n") // Collapse multiple newlines
        .toLowerCase()
        .trim();
}

module.exports = normalizeText;
