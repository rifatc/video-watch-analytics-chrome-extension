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

// Calculate and display website breakdown across all dates
function updateSiteBreakdown(history) {
    const siteTotals = {};

    // Aggregate across all dates
    for (const [date, stats] of Object.entries(history)) {
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
        breakdownDiv.innerHTML = '<p style="text-align: center; color: #888;">No website data available yet. Watch some videos to see breakdown!</p>';
        return;
    }

    let html = '<table style="width: 100%; border-collapse: collapse; margin-top: 8px; background-color: #252530; border-radius: 12px; overflow: hidden; box-shadow: inset 3px 3px 7px rgba(0, 0, 0, 0.5), inset -3px -3px 7px rgba(70, 70, 90, 0.3); padding: 12px;">';
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

function exportToCSV() {
    chrome.storage.local.get(['videoWatchHistory'], function(result) {
        const history = result.videoWatchHistory || {};
        
        // Sort dates in descending order
        const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));
        
        // Create CSV header
        let csvContent = 'Date,Duration Watched,Actual Time Watched,Time Saved,Time Saved Percentage\n';
        
        // Add data rows
        sortedDates.forEach(date => {
            const stats = history[date];
            const timeSaved = stats.durationWatched - stats.actualTimeWatched;
            const timeSavedPercentage = (timeSaved / stats.durationWatched * 100).toFixed(2);
            
            // Format raw seconds for CSV (we want raw numbers for better data analysis)
            csvContent += `${date},${stats.durationWatched},${stats.actualTimeWatched},${timeSaved},${timeSavedPercentage}%\n`;
        });
        
        // Create a blob and download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `video_watch_history_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

function importFromCSV() {
    const fileInput = document.getElementById('importFile');
    fileInput.click();
    
    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const csvContent = e.target.result;
                const lines = csvContent.split('\n');
                
                // Skip header line
                if (lines.length < 2) {
                    alert('Invalid CSV file format');
                    return;
                }
                
                // Get existing history
                chrome.storage.local.get(['videoWatchHistory'], function(result) {
                    let videoWatchHistory = result.videoWatchHistory || {};
                    let importCount = 0;
                    
                    // Process each line (skip header)
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        
                        const values = line.split(',');
                        if (values.length < 3) continue;
                        
                        const date = values[0];
                        const durationWatched = parseFloat(values[1]);
                        const actualTimeWatched = parseFloat(values[2]);
                        
                        // Validate data
                        if (isNaN(durationWatched) || isNaN(actualTimeWatched) || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            continue;
                        }
                        
                        // Update or create entry
                        if (!videoWatchHistory[date]) {
                            videoWatchHistory[date] = {
                                durationWatched: 0,
                                actualTimeWatched: 0
                            };
                        }
                        
                        // Add imported values to existing values
                        videoWatchHistory[date].durationWatched += durationWatched;
                        videoWatchHistory[date].actualTimeWatched += actualTimeWatched;
                        importCount++;
                    }
                    
                    // Save updated history
                    chrome.storage.local.set({videoWatchHistory: videoWatchHistory}, function() {
                        alert(`Successfully imported ${importCount} records`);
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
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    document.getElementById('importBtn').addEventListener('click', importFromCSV);
});
