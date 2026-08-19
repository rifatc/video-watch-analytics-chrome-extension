async function checkTabForVideo(tabId) {
    try {
        const tab = await browser.tabs.get(tabId);
        if (tab.audible) {
            browser.tabs.sendMessage(tabId, { action: 'checkForVideo' });
        }
    } catch (error) {
        // Tab is no longer valid, silently ignore
    }
}

// Check when a tab is updated
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined) {
        checkTabForVideo(tabId);
    }
});

// Check when a tab is activated (user switches to the tab)
browser.tabs.onActivated.addListener(({ tabId }) => {
    checkTabForVideo(tabId);
});

// Periodically check all tabs (in case we missed any events)
// Use a flag to prevent duplicate intervals when the background script restarts
let pollingInterval = null;

function startPolling() {
    // Clear any existing interval to prevent duplicates
    if (pollingInterval !== null) {
        clearInterval(pollingInterval);
    }

    pollingInterval = setInterval(() => {
        browser.tabs.query({}).then(tabs => {
            tabs.forEach(tab => checkTabForVideo(tab.id));
        });
    }, 10000);  // Check every 10 seconds
}

// Start polling when the background script activates
startPolling();
