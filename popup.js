const ROWS_PER_PAGE = 7; // 7 days per page
let currentPage = 1;
let totalPages = 1;
let paginatedHistory = [];

function formatTime(seconds) {
    // Handle negatives explicitly: Math.floor rounds toward -Infinity, which
    // used to produce nonsense like "-2h -2m -1s" for -3661s (e.g. negative
    // time saved after playback stalls or sub-1x segments).
    const sign = seconds < 0 ? '-' : '';
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = Math.floor(absSeconds % 60);
    return `${sign}${hours}h ${minutes}m ${secs}s`;
}

function updatePopup() {
    chrome.storage.local.get(['videoWatchHistory'], function(result) {
        const history = result.videoWatchHistory || {};
        let totalDuration = 0;
        let totalActual = 0;

        // Sort dates in descending order
        const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));

        paginatedHistory = sortedDates.map(date => {
            const stats = history[date];
            totalDuration += stats.durationWatched;
            totalActual += stats.actualTimeWatched;
            const timeSaved = stats.durationWatched - stats.actualTimeWatched;
            const timeSavedPercentage = stats.durationWatched > 0
                ? (timeSaved / stats.durationWatched * 100).toFixed(2)
                : '0.00';
            return {
                date,
                durationWatched: formatTime(stats.durationWatched),
                actualTimeWatched: formatTime(stats.actualTimeWatched),
                timeSaved: `${formatTime(timeSaved)} (${timeSavedPercentage}%)`
            };
        });

        totalPages = Math.ceil(paginatedHistory.length / ROWS_PER_PAGE);
        updateTable();
        updatePaginationControls();

        const timeSaved = totalDuration - totalActual;
        const timeSavedPercentage = totalDuration > 0
            ? (timeSaved / totalDuration * 100).toFixed(2)
            : '0.00';
        document.getElementById('totalStats').innerHTML = `
            <p>Total Time: ${formatTime(totalDuration)}</p>
            <p>Actual Time: ${formatTime(totalActual)}</p>
            <p>Time Saved: ${formatTime(timeSaved)} (${timeSavedPercentage}%)</p>
        `;
    });
}

function updateTable() {
    const table = document.getElementById('historyTable');

    // Clear existing rows except header
    while (table.rows.length > 1) {
        table.deleteRow(1);
    }

    const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
    const endIndex = startIndex + ROWS_PER_PAGE;
    const pageData = paginatedHistory.slice(startIndex, endIndex);

    pageData.forEach(item => {
        const row = table.insertRow();

        row.insertCell(0).textContent = item.date;
        row.insertCell(1).textContent = item.durationWatched;
        row.insertCell(2).textContent = item.actualTimeWatched;
        row.insertCell(3).textContent = item.timeSaved;
    });
}

function updatePaginationControls() {
    const paginationDiv = document.getElementById('pagination');
    paginationDiv.innerHTML = `
        <button id="prevPage" ${currentPage === 1 ? 'disabled' : ''}><<</button>
        <span>Page ${currentPage} of ${totalPages}</span>
        <button id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>>></button>
    `;
}

function exportToJSON() {
    chrome.storage.local.get(['videoWatchHistory'], function(result) {
        const history = result.videoWatchHistory || {};

        // Create JSON with sorted dates
        const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));
        const exportData = {
            exportDate: new Date().toISOString(),
            version: '2.0',
            data: {}
        };

        sortedDates.forEach(date => {
            exportData.data[date] = history[date];
        });

        // Create a blob and download link
        const jsonContent = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `video_watch_history_${new Date().toISOString().split('T')[0]}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

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

function importFromJSON() {
    const fileInput = document.getElementById('importFile');
    fileInput.click();

    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const jsonContent = e.target.result;
                const importData = JSON.parse(jsonContent);

                // Validate import data structure
                if (!importData.data || typeof importData.data !== 'object' || Array.isArray(importData.data)) {
                    alert('Invalid JSON file format. Missing or invalid "data" field.');
                    return;
                }

                // Get existing history
                chrome.storage.local.get(['videoWatchHistory'], function(result) {
                    const videoWatchHistory = result.videoWatchHistory || {};
                    const importCount = mergeImportedHistory(videoWatchHistory, importData);

                    // Save updated history
                    chrome.storage.local.set({videoWatchHistory: videoWatchHistory}, function() {
                        if (importCount > 0) {
                            alert(`Successfully imported ${importCount} days of data`);
                        } else {
                            alert('No valid data found to import');
                        }
                        updatePopup(); // Refresh the display
                    });
                });
            } catch (error) {
                alert('Error importing data: ' + error.message);
                console.error('Import error:', error);
            }
        };

        reader.readAsText(file);
        // Reset the file input so the same file can be selected again
        fileInput.value = '';
    }, {once: true}); // Use once:true to prevent multiple event handlers
}

document.addEventListener('DOMContentLoaded', () => {
    // Use the existing pagination div from HTML instead of creating a new one
    const paginationDiv = document.getElementById('pagination');

    // Event delegation for pagination buttons (prevents memory leak from duplicate listeners)
    paginationDiv.addEventListener('click', (event) => {
        if (event.target.id === 'prevPage' && currentPage > 1) {
            currentPage--;
            updateTable();
            updatePaginationControls();
        } else if (event.target.id === 'nextPage' && currentPage < totalPages) {
            currentPage++;
            updateTable();
            updatePaginationControls();
        }
    });

    // Now call updatePopup (which will call updatePaginationControls)
    updatePopup();

    // Add event listeners for export and import buttons
    document.getElementById('exportBtn').addEventListener('click', exportToJSON);
    document.getElementById('importBtn').addEventListener('click', importFromJSON);
});
