const stringSimilarity = require("string-similarity");

function compareText(extractedText, userInput) {
    if (!extractedText || !userInput) {
        return 0; // Return 0 if either is missing
    }

    const normalizedExtracted = extractedText.toLowerCase();
    const normalizedInput = userInput.toLowerCase();

    // 1. Substring Match (Case-insensitive)
    if (normalizedExtracted.includes(normalizedInput)) {
        return {
            raw_similarity: 1, // Treat as perfect match
            score: 100
        };
    }

    // 2. Normalized Match (Ignore spaces/symbols)
    // Helps with "7004 8984 4290" matching "700489844290"
    // or "0691/16020/00847" matching "06911602000847"
    const simpleExtracted = normalizedExtracted.replace(/[^a-z0-9]/gi, "");
    const simpleInput = normalizedInput.replace(/[^a-z0-9]/gi, "");

    if (simpleInput.length > 3 && simpleExtracted.includes(simpleInput)) {
        return {
            raw_similarity: 1,
            score: 100
        };
    }

    // 3. Fuzzy Window Match (Best Substring)
    // iterate over the extracted text to find the best matching substring of similar length
    let bestSimilarity = 0;
    const inputLen = normalizedInput.length;

    // Performance optimization: only run fuzzy logic if input is substantial enough to matter
    if (inputLen > 3) {
        // We find the best match using the original strings (lowercased) to preserve some structure if needed,
        // but normalized strings are usually better for "content" matching.
        // Let's use normalizedExtracted which preserves spaces/newlines.

        const targetLen = normalizedExtracted.length;

        // Sliding window
        // Limit the window scan for performance if text is huge? 
        // For standard docs (few pages), it's fast enough.
        for (let i = 0; i <= targetLen - inputLen; i++) {
            const window = normalizedExtracted.substring(i, i + inputLen);
            // Quick check: if first char doesn't match, skip? No, typo could be first char.

            const sim = stringSimilarity.compareTwoStrings(window, normalizedInput);
            if (sim > bestSimilarity) {
                bestSimilarity = sim;
            }
            // Optimization: if we find a very high match, break early
            if (bestSimilarity > 0.95) break;
        }
    }



    let score = 0;
    if (bestSimilarity >= 0.9) {
        score = 90; // Almost matched
    } else if (bestSimilarity >= 0.7) {
        score = 70; // Partial match
    } else if (bestSimilarity >= 0.5) {
        score = 50; // Slightly match
    } else {
        score = 0; // No match
    }

    return {
        raw_similarity: bestSimilarity,
        score: score
    };
}


module.exports = compareText;
