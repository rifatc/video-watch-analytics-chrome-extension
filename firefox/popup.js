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
    browser.storage.local.get(['videoWatchHistory']).then((result) => {
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
    browser.storage.local.get(['videoWatchHistory']).then((result) => {
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
    // Firefox closes the popup when a native file picker opens from inside it,
    // which kills the page before the file selection can be processed.
    // Opening the picker in a full tab avoids that.
    browser.tabs.create({
        url: browser.runtime.getURL('import.html')
    });
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
