const ROWS_PER_PAGE = 7; // 7 days per page
let currentPage = 1;
let totalPages = 1;
let paginatedHistory = [];

function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
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
                if (!importData.data || typeof importData.data !== 'object') {
                    alert('Invalid JSON file format. Missing "data" field.');
                    return;
                }

                // Get existing history
                chrome.storage.local.get(['videoWatchHistory'], function(result) {
                    let videoWatchHistory = result.videoWatchHistory || {};
                    let importCount = 0;
                    let updatedCount = 0;

                    // Process each date from import
                    for (const [date, stats] of Object.entries(importData.data)) {
                        // Validate date format
                        if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            console.warn(`Skipping invalid date: ${date}`);
                            continue;
                        }

                        // Validate stats structure
                        if (!stats || typeof stats !== 'object') {
                            console.warn(`Skipping invalid stats for date: ${date}`);
                            continue;
                        }

                        // Create or update entry
                        if (!videoWatchHistory[date]) {
                            videoWatchHistory[date] = {
                                durationWatched: 0,
                                actualTimeWatched: 0
                            };
                        }

                        // Merge totals
                        if (stats.durationWatched && !isNaN(stats.durationWatched)) {
                            videoWatchHistory[date].durationWatched += stats.durationWatched;
                        }
                        if (stats.actualTimeWatched && !isNaN(stats.actualTimeWatched)) {
                            videoWatchHistory[date].actualTimeWatched += stats.actualTimeWatched;
                        }

                        // Merge byHour if present
                        if (stats.byHour && typeof stats.byHour === 'object') {
                            if (!videoWatchHistory[date].byHour) {
                                videoWatchHistory[date].byHour = {};
                            }
                            for (const [hour, seconds] of Object.entries(stats.byHour)) {
                                if (!videoWatchHistory[date].byHour[hour]) {
                                    videoWatchHistory[date].byHour[hour] = 0;
                                }
                                videoWatchHistory[date].byHour[hour] += seconds || 0;
                            }
                        }

                        if (Object.keys(videoWatchHistory).includes(date)) {
                            importCount++;
                        }
                        if (Object.keys(importData.data).includes(date)) {
                            updatedCount++;
                        }
                    }

                    // Save updated history
                    chrome.storage.local.set({videoWatchHistory: videoWatchHistory}, function() {
                        alert(`Successfully imported ${importCount} days of data`);
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
