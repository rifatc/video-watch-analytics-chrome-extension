const ROWS_PER_PAGE = 7; // 7 days per page
let currentPage = 1;
let totalPages = 1;
let paginatedHistory = [];
let selectedDate = null; // null = show all time, otherwise YYYY-MM-DD

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

        // Update website breakdown
        updateSiteBreakdown(history);
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

        // Date cell - clickable to filter website breakdown
        const dateCell = row.insertCell(0);
        dateCell.textContent = item.date;
        dateCell.style.cursor = 'pointer';
        dateCell.style.textDecoration = 'underline';
        dateCell.style.color = selectedDate === item.date ? '#4fc3f7' : '#e0e0e0';
        dateCell.title = selectedDate === item.date ? 'Click to show all websites' : 'Click to show websites for this day';
        dateCell.onclick = () => {
            if (selectedDate === item.date) {
                selectedDate = null; // Deselect
            } else {
                selectedDate = item.date; // Select
            }
            // Refresh both table (for highlight) and breakdown
            updatePopup();
        };

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

// Calculate and display website breakdown (all dates or filtered by selectedDate)
function updateSiteBreakdown(history) {
    const siteTotals = {};

    // Filter dates based on selection
    const datesToProcess = selectedDate
        ? { [selectedDate]: history[selectedDate] }
        : history;

    // Aggregate across filtered dates
    for (const [date, stats] of Object.entries(datesToProcess)) {
        if (stats.bySite) {
            for (const [hostname, siteStats] of Object.entries(stats.bySite)) {
                if (!siteTotals[hostname]) {
                    siteTotals[hostname] = {
                        durationWatched: 0,
                        actualTimeWatched: 0
                    };
                }
                siteTotals[hostname].durationWatched += siteStats.durationWatched;
                siteTotals[hostname].actualTimeWatched += siteStats.actualTimeWatched;
            }
        }
    }

    // Sort by duration watched (descending)
    const sortedSites = Object.entries(siteTotals)
        .sort((a, b) => b[1].durationWatched - a[1].durationWatched)
        .map(([hostname, stats]) => ({
            hostname,
            durationWatched: stats.durationWatched,
            actualTimeWatched: stats.actualTimeWatched,
            percentage: stats.durationWatched > 0
                ? (stats.durationWatched / Object.values(siteTotals).reduce((sum, s) => sum + s.durationWatched, 0) * 100).toFixed(1)
                : '0.0'
        }));

    // Display breakdown
    const breakdownDiv = document.getElementById('siteBreakdown');
    if (!breakdownDiv) return;

    if (sortedSites.length === 0) {
        const message = selectedDate
            ? `No website data for ${selectedDate}. Watch some videos on this date!`
            : 'No website data available yet. Watch some videos to see breakdown!';
        breakdownDiv.innerHTML = `<p style="text-align: center; color: #888;">${message}</p>`;
        return;
    }

    // Update header to show what's being displayed
    const headerText = selectedDate
        ? `Website Breakdown - ${selectedDate}`
        : 'Website Breakdown - All Time';

    let html = `<h3 style="margin: 0 0 8px 0; font-size: 14px; color: #4fc3f7;">${headerText}</h3>`;
    html += '<table style="width: 100%; border-collapse: collapse; margin-top: 8px; background-color: #252530; border-radius: 12px; overflow: hidden; box-shadow: inset 3px 3px 7px rgba(0, 0, 0, 0.5), inset -3px -3px 7px rgba(70, 70, 90, 0.3); padding: 12px;">';
    html += '<tr><th style="background: #2a2a35; color: #e0e0e0; font-weight: 600; padding: 8px 6px; text-align: left; border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3);">Website</th>';
    html += '<th style="background: #2a2a35; color: #e0e0e0; font-weight: 600; padding: 8px 6px; text-align: left; border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3);">Time Watched</th>';
    html += '<th style="background: #2a2a35; color: #e0e0e0; font-weight: 600; padding: 8px 6px; text-align: left; border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3);">%</th></tr>';

    sortedSites.forEach(site => {
        html += '<tr>';
        html += `<td style="border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3); padding: 8px 6px; text-align: left;">${site.hostname}</td>`;
        html += `<td style="border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3); padding: 8px 6px; text-align: left;">${formatTime(site.durationWatched)}</td>`;
        html += `<td style="border: none; border-bottom: 1px solid rgba(70, 70, 90, 0.3); padding: 8px 6px; text-align: left;">${site.percentage}%</td>`;
        html += '</tr>';
    });

    html += '</table>';
    breakdownDiv.innerHTML = html;
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

                        // Merge bySite if present
                        if (stats.bySite && typeof stats.bySite === 'object') {
                            if (!videoWatchHistory[date].bySite) {
                                videoWatchHistory[date].bySite = {};
                            }
                            for (const [hostname, siteStats] of Object.entries(stats.bySite)) {
                                if (!videoWatchHistory[date].bySite[hostname]) {
                                    videoWatchHistory[date].bySite[hostname] = {
                                        durationWatched: 0,
                                        actualTimeWatched: 0
                                    };
                                }
                                videoWatchHistory[date].bySite[hostname].durationWatched += siteStats.durationWatched || 0;
                                videoWatchHistory[date].bySite[hostname].actualTimeWatched += siteStats.actualTimeWatched || 0;
                            }
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
