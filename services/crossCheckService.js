/**
 * Service for logical cross-checks on document data.
 * Examples: Future date check, Amount validation, etc.
 */
function runCrossChecks(docText, rules, issues) {
    if (!rules.cross_checks) return;

    rules.cross_checks.forEach(check => {
        // Example: DATE_NOT_FUTURE
        if (check === "DATE_NOT_FUTURE") {
            // Match DD-MM-YYYY or DD/MM/YYYY
            const dates = docText.match(/\b\d{2}[-\/]\d{2}[-\/]\d{4}\b/g) || [];
            dates.forEach(d => {
                try {
                    const parts = d.split(/[-\/]/);
                    // Ensure we have day, month, year
                    if (parts.length === 3) {
                        const day = parseInt(parts[0], 10);
                        const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
                        const year = parseInt(parts[2], 10);

                        // Basic validation that it is a date
                        const parsed = new Date(year, month, day);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        // Check if valid date and if it is in the future (ignore today)
                        if (parsed > today && parsed.getFullYear() <= today.getFullYear() + 20) {
                            issues.cross_checks.push({
                                code: "FUTURE_DATE_RISK",
                                severity: "HIGH",
                                message: `Future date detected in document: ${d}`
                            });
                        }
                    }
                } catch (e) {
                    // ignore parsing errors
                }
            });
        }

        if (check === "ANNUAL_GE_DAILY_X_365") {
            // Check if Annual >= Daily * 365
            const dailyMatch = docText.match(/Daily.*?(\d+(?:,\d+)*(?:\.\d+)?)/i);
            const annualMatch = docText.match(/Annual.*?(\d+(?:,\d+)*(?:\.\d+)?)/i);

            if (dailyMatch && annualMatch) {
                const daily = parseFloat(dailyMatch[1].replace(/,/g, ''));
                const annual = parseFloat(annualMatch[1].replace(/,/g, ''));

                if (annual < daily * 365) {
                    issues.cross_checks.push({
                        code: "LOGICAL_INCONSISTENCY",
                        severity: "HIGH",
                        message: `Annual water requirement (${annual}) is less than Daily (${daily}) * 365. Expected >= ${daily * 365}`
                    });
                }
            }
        }
    }); // End of forEach
}

module.exports = runCrossChecks;
