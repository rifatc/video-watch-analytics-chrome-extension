// --- Shared validation (keep in sync with popup.js) ---

// Returns true if the value can safely be used as a seconds count in stored
// history. Rejects negatives, non-numbers (strings like "5" used to corrupt
// totals via coercion), non-finite values (JSON "1e400" parses to Infinity,
// which used to poison every downstream total), and absurd magnitudes (values
// above 1e9 seconds - over 31 years in one day - are definitionally garbage,
// and two 1e308 entries used to sum to Infinity after passing validation).
function isValidSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
}

// Merges validated entries from importData.data into videoWatchHistory.
// Returns the number of days that received valid data. Days whose fields are
// all invalid are skipped entirely instead of being created as zero entries.
function mergeImportedHistory(videoWatchHistory, importData) {
    let importCount = 0;

    for (const [date, stats] of Object.entries(importData.data)) {
        // Validate date format AND that it is a real calendar date.
        // "2026-13-45" passes the regex but makes popup date sorting
        // (new Date comparisons) return NaN and scramble pagination.
        if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.warn(`Skipping invalid date: ${date}`);
            continue;
        }
        const parsedDate = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
            console.warn(`Skipping non-calendar date: ${date}`);
            continue;
        }

        // Validate stats structure (plain object - not null, array, etc.)
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
            console.warn(`Skipping invalid stats for date: ${date}`);
            continue;
        }

        // Collect validated pieces first so a day with only garbage is not
        // created as an empty entry.
        let duration = 0;
        let actual = 0;
        const byHour = {};

        if (isValidSeconds(stats.durationWatched)) {
            duration += stats.durationWatched;
        } else if (stats.durationWatched !== undefined) {
            console.warn(`Skipping invalid durationWatched for ${date}:`, stats.durationWatched);
        }

        if (isValidSeconds(stats.actualTimeWatched)) {
            actual += stats.actualTimeWatched;
        } else if (stats.actualTimeWatched !== undefined) {
            console.warn(`Skipping invalid actualTimeWatched for ${date}:`, stats.actualTimeWatched);
        }

        if (stats.byHour && typeof stats.byHour === 'object' && !Array.isArray(stats.byHour)) {
            for (const [hour, seconds] of Object.entries(stats.byHour)) {
                // Hour keys must be integers 0-23 ("banana" and "25" used to be
                // accepted verbatim, "__proto__" is defused by this gate too).
                const hourNum = Number(hour);
                if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) {
                    console.warn(`Skipping invalid hour key "${hour}" for ${date}`);
                    continue;
                }
                if (!isValidSeconds(seconds)) {
                    console.warn(`Skipping invalid seconds for hour "${hour}" on ${date}:`, seconds);
                    continue;
                }
                const hourKey = String(hourNum);
                byHour[hourKey] = (byHour[hourKey] || 0) + seconds;
            }
        } else if (stats.byHour !== undefined) {
            console.warn(`Skipping invalid byHour for ${date}`);
        }

        // Only import days that contribute a nonzero amount somewhere.
        // All-zero fields pass isValidSeconds but add nothing - importing them
        // would just create empty table rows and inflate the imported-days
        // count (a hostile file of a million zero days once looked "valid").
        const hasContribution = duration > 0 || actual > 0 ||
            Object.values(byHour).some((seconds) => seconds > 0);
        if (!hasContribution) {
            console.warn(`No nonzero data for date ${date}, skipping`);
            continue;
        }

        // Create or update entry
        if (!videoWatchHistory[date]) {
            videoWatchHistory[date] = {
                durationWatched: 0,
                actualTimeWatched: 0
            };
        }

        videoWatchHistory[date].durationWatched += duration;
        videoWatchHistory[date].actualTimeWatched += actual;

        if (Object.keys(byHour).length > 0) {
            if (!videoWatchHistory[date].byHour) {
                videoWatchHistory[date].byHour = {};
            }
            for (const [hourKey, seconds] of Object.entries(byHour)) {
                videoWatchHistory[date].byHour[hourKey] = (videoWatchHistory[date].byHour[hourKey] || 0) + seconds;
            }
        }

        importCount++;
    }

    return importCount;
}

// --- Import UI ---

const fileInput = document.getElementById('importFile');
const importBtn = document.getElementById('importBtn');
const statusDiv = document.getElementById('status');

let selectedFile = null;

fileInput.addEventListener('change', (event) => {
    selectedFile = event.target.files[0] || null;
    importBtn.disabled = !selectedFile;
    statusDiv.textContent = '';
    statusDiv.className = '';
});

function setStatus(message, isError) {
    statusDiv.textContent = message;
    statusDiv.className = isError ? 'error' : 'success';
}

importBtn.addEventListener('click', () => {
    if (!selectedFile) return;
    importBtn.disabled = true;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importData = JSON.parse(e.target.result);

            if (!importData.data || typeof importData.data !== 'object' || Array.isArray(importData.data)) {
                setStatus('Invalid JSON file format. Missing or invalid "data" field.', true);
                importBtn.disabled = false;
                return;
            }

            browser.storage.local.get(['videoWatchHistory']).then((result) => {
                const videoWatchHistory = result.videoWatchHistory || {};
                const importCount = mergeImportedHistory(videoWatchHistory, importData);

                browser.storage.local.set({videoWatchHistory: videoWatchHistory}).then(() => {
                    if (importCount > 0) {
                        setStatus(`Successfully imported ${importCount} day(s) of data. You can close this tab.`, false);
                    } else {
                        setStatus('No valid data found to import.', true);
                    }
                    importBtn.disabled = false;
                });
            });
        } catch (error) {
            setStatus('Error importing data: ' + error.message, true);
            console.error('Import error:', error);
            importBtn.disabled = false;
        }
    };

    reader.readAsText(selectedFile);
});
