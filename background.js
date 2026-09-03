function checkTabForVideo(tabId) {
    chrome.tabs.get(tabId, (tab) => {
        // Check for errors (e.g., tab was closed or doesn't exist)
        if (chrome.runtime.lastError) {
            // Tab is no longer valid, silently ignore
            return;
        }

        if (tab.audible) {
            // Swallow "Receiving end does not exist" errors for tabs whose
            // content script is absent (e.g. tabs opened before the extension
            // was installed or reloaded).
            chrome.tabs.sendMessage(tabId, { action: 'checkForVideo' }).catch((error) => {
                console.debug(`[Video Analytics] No content script in audible tab ${tabId} (expected for pages opened before install/reload): ${error.message}`);
            });
        }
    });
}

// Check when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
        checkTabForVideo(tabId);
    }
});

// Check when a tab is activated (user switches to the tab)
chrome.tabs.onActivated.addListener(({ tabId }) => {
    checkTabForVideo(tabId);
});

// Periodically check all tabs (in case we missed any events)
// Use a flag to prevent duplicate intervals when service worker restarts
let pollingInterval = null;

function startPolling() {
    // Clear any existing interval to prevent duplicates
    if (pollingInterval !== null) {
        clearInterval(pollingInterval);
    }

    pollingInterval = setInterval(() => {
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => checkTabForVideo(tab.id));
        });
    }, 10000);  // Check every 10 seconds
}

// Start polling when service worker activates
startPolling();
