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

            if (!importData.data || typeof importData.data !== 'object') {
                setStatus('Invalid JSON file format. Missing "data" field.', true);
                importBtn.disabled = false;
                return;
            }

            browser.storage.local.get(['videoWatchHistory']).then((result) => {
                let videoWatchHistory = result.videoWatchHistory || {};
                let importCount = 0;

                for (const [date, stats] of Object.entries(importData.data)) {
                    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        console.warn(`Skipping invalid date: ${date}`);
                        continue;
                    }

                    if (!stats || typeof stats !== 'object') {
                        console.warn(`Skipping invalid stats for date: ${date}`);
                        continue;
                    }

                    if (!videoWatchHistory[date]) {
                        videoWatchHistory[date] = {
                            durationWatched: 0,
                            actualTimeWatched: 0
                        };
                    }

                    if (stats.durationWatched && !isNaN(stats.durationWatched)) {
                        videoWatchHistory[date].durationWatched += stats.durationWatched;
                    }
                    if (stats.actualTimeWatched && !isNaN(stats.actualTimeWatched)) {
                        videoWatchHistory[date].actualTimeWatched += stats.actualTimeWatched;
                    }

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

                    importCount++;
                }

                browser.storage.local.set({videoWatchHistory: videoWatchHistory}).then(() => {
                    setStatus(`Successfully imported ${importCount} day(s) of data. You can close this tab.`, false);
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
