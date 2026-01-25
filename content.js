// This script is designed to track and store the amount of time a user spends watching videos on a webpage. 
// It uses Chrome's local storage to keep a record of the total duration watched and the actual time spent watching videos for each day.

// Returns today's date in YYYY-MM-DD format.
function getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Initializes or updates the local storage with an entry for today if it doesn't exist.
function initializeStorage() {
    chrome.storage.local.get(['videoWatchHistory'], function (result) {
        let videoWatchHistory = result.videoWatchHistory || {};
        const today = getTodayDate();
        if (!videoWatchHistory[today]) {
            videoWatchHistory[today] = {
                durationWatched: 0,
                actualTimeWatched: 0
            };
            chrome.storage.local.set({videoWatchHistory: videoWatchHistory});
            console.log(`[Video Analytics] Initialized storage for today: ${today}`);
        } else {
            console.log(`[Video Analytics] Storage exists for ${today}, existing data:`, videoWatchHistory[today]);
        }
    });
}

// Variables to keep track of video playback times and intervals.
let lastStorageUpdateTime = 0;
let isTrackingInitialized = false; // Prevent multiple initialization

// Per-video state tracking using WeakMap to avoid memory leaks
const videoStates = new WeakMap();

// Set to track video references (WeakMap is not iterable)
const trackedVideos = new Set();

// Get or create state for a video element
function getVideoState(video) {
    if (!videoStates.has(video)) {
        videoStates.set(video, {
            lastUpdateTime: 0,
            accumulatedTime: 0,
            actualTimeWatched: 0,
            lastActualTimeUpdate: 0
        });
        trackedVideos.add(video);
    }
    return videoStates.get(video);
}

// Updates the local storage with the accumulated time watched and resets the counters.
function updateStorage() {
    chrome.storage.local.get(['videoWatchHistory'], function (result) {
        let videoWatchHistory = result.videoWatchHistory || {};
        const today = getTodayDate();

        if (!videoWatchHistory[today]) {
            videoWatchHistory[today] = {
                durationWatched: 0,
                actualTimeWatched: 0
            };
        }

        // Accumulate time from all tracked videos
        let totalAccumulatedTime = 0;
        let totalActualTimeWatched = 0;

        // Iterate through all tracked videos and sum their times
        // Use a copy of the set to avoid issues if it's modified during iteration
        const videosToProcess = new Set(trackedVideos);
        for (const video of videosToProcess) {
            // Only count if the video is still in the DOM
            if (document.contains(video)) {
                const state = videoStates.get(video);
                if (state) {
                    totalAccumulatedTime += state.accumulatedTime;
                    totalActualTimeWatched += state.actualTimeWatched;
                    // Reset the counters for this video
                    state.accumulatedTime = 0;
                    state.actualTimeWatched = 0;
                }
            } else {
                // Video is no longer in DOM, clean up
                trackedVideos.delete(video);
            }
        }

        videoWatchHistory[today].durationWatched += totalAccumulatedTime;
        videoWatchHistory[today].actualTimeWatched += totalActualTimeWatched;

        chrome.storage.local.set({videoWatchHistory: videoWatchHistory});

        console.log(`[Video Analytics] Storage updated: +${totalAccumulatedTime.toFixed(1)}s duration, +${totalActualTimeWatched.toFixed(1)}s actual. Total: ${videoWatchHistory[today]}`);
    });
}

// Handles the 'timeupdate' event for videos, updating the watched time.
function handleTimeUpdate(event) {
    const video = event.target;
    const state = getVideoState(video);
    const currentTime = video.currentTime;
    const currentActualTime = Date.now() / 1000; // Convert to seconds

    if (state.lastUpdateTime > 0) {
        const timeDiff = currentTime - state.lastUpdateTime;

        // Only count time increments smaller than 4.5 seconds to ignore large skips.
        if (timeDiff > 0 && timeDiff < 4.5) {
            state.accumulatedTime += timeDiff;
        }

        // Update actual time watched if the video is playing.
        if (!video.paused) {
            const actualTimeDiff = currentActualTime - state.lastActualTimeUpdate;
            state.actualTimeWatched += actualTimeDiff;
        }
    }

    state.lastUpdateTime = currentTime;
    state.lastActualTimeUpdate = currentActualTime;

    // Log summary every 10 seconds of accumulated time
    if (state.accumulatedTime > 0 && Math.floor(state.accumulatedTime) % 10 === 0 && Math.floor(state.accumulatedTime) !== state.lastLoggedTime) {
        state.lastLoggedTime = Math.floor(state.accumulatedTime);
        const videoSrc = video.src || video.currentSrc || 'video';
        console.log(`[Video Analytics] Progress: ${videoSrc} - ${state.accumulatedTime.toFixed(1)}s duration, ${state.actualTimeWatched.toFixed(1)}s actual time`);
    }

    // Periodically update the storage every 30 seconds.
    if (Date.now() - lastStorageUpdateTime >= 30000) {
        updateStorage();
        lastStorageUpdateTime = Date.now();
    }
}

// Attaches necessary event listeners to a video element.
function attachListenersToVideo(video) {
    if (!video.hasAttribute('data-tracked')) {
        // Initialize state for this video
        getVideoState(video);
        const videoSrc = video.src || video.currentSrc || 'unknown source';
        console.log(`[Video Analytics] Attaching listeners to video: ${videoSrc}`);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', function () {
            const state = getVideoState(video);
            state.lastActualTimeUpdate = Date.now() / 1000; // Update the last actual time on play.
            console.log(`[Video Analytics] Video started playing: ${videoSrc}`);
        });
        video.addEventListener('pause', function () {
            const state = getVideoState(video);
            const currentActualTime = Date.now() / 1000;
            state.actualTimeWatched += currentActualTime - state.lastActualTimeUpdate; // Update watched time on pause.
            console.log(`[Video Analytics] Video paused. Session: accumulated=${state.accumulatedTime.toFixed(1)}s, actual=${state.actualTimeWatched.toFixed(1)}s`);
            updateStorage();
        });
        video.setAttribute('data-tracked', 'true');
    }
}

// Initializes video tracking by setting up storage and attaching event listeners to all video elements.
function initializeTracking() {
    // Prevent multiple initialization
    if (isTrackingInitialized) {
        console.log('[Video Analytics] Tracking already initialized, skipping...');
        return;
    }
    isTrackingInitialized = true;
    console.log('[Video Analytics] Initializing tracking for the first time...');

    initializeStorage();

    // Attach listeners to any existing video elements.
    const videos = document.getElementsByTagName('video');
    let newVideosAttached = 0;
    for (let video of videos) {
        if (!video.hasAttribute('data-tracked')) {
            attachListenersToVideo(video);
            newVideosAttached++;
        }
    }
    console.log(`[Video Analytics] Attached listeners to ${newVideosAttached} new video(s) (total on page: ${videos.length})`);

    // Monitor the document for newly added video elements and attach listeners to them.
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeName === 'VIDEO') {
                        console.log('[Video Analytics] New video detected in DOM, attaching listeners...');
                        attachListenersToVideo(node);
                    }
                });
            }
        });
    });

    observer.observe(document.body, {childList: true, subtree: true});

    // Add event listener to save data before tab is closed
    window.addEventListener('beforeunload', function() {
        console.log('[Video Analytics] Tab closing, saving final data...');
        updateStorage();
    });
}

// Checks for video elements on the page and initializes tracking if found. If not, retries after a delay.
function checkForVideos() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
        if (!isTrackingInitialized) {
            console.log(`[Video Analytics] Found ${videos.length} video(s) on page, initializing tracking...`);
            initializeTracking();
        } else {
            // Tracking is already initialized, just check for new videos
            let newVideosCount = 0;
            for (let video of videos) {
                if (!video.hasAttribute('data-tracked')) {
                    attachListenersToVideo(video);
                    newVideosCount++;
                }
            }
            if (newVideosCount > 0) {
                console.log(`[Video Analytics] Found ${newVideosCount} new untracked video(s) on page`);
            }
        }
    } else {
        console.log('[Video Analytics] No videos found, retrying in 10 seconds...');
        setTimeout(checkForVideos, 10000); // Retry after 10 second if no videos are found.
    }
}

function startTracking() {
    checkForVideos();
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'checkForVideo') {
        console.log('[Video Analytics] Received signal from background script, starting tracking...');
        startTracking();
    }
});

// We don't automatically start tracking anymore.
// Instead, we wait for a signal from the background script.
console.log('[Video Analytics] Content script loaded, waiting for background script signal');
