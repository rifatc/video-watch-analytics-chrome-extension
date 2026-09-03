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

// In-memory mirror of chrome.storage.local's "videoWatchHistory".
// All merges happen synchronously against this cache, so consecutive flushes
// within this frame can never interleave read-modify-write cycles.
let cachedHistory = {};
let storageLoaded = false;

// Variables to keep track of video playback times and intervals.
let lastStorageUpdateTime = 0;
let isTrackingInitialized = false; // Prevent multiple initialization
let mutationObserver = null; // Store observer reference for cleanup
let retryTimer = null; // Only ever one pending checkForVideos retry timer

// Per-video state tracking using WeakMap to avoid memory leaks
const videoStates = new WeakMap();

// Set to track video references (WeakMap is not iterable)
const trackedVideos = new Set();

// Get or create state for a video element
function getVideoState(video) {
    const isNewVideo = !videoStates.has(video);
    if (isNewVideo) {
        videoStates.set(video, {
            lastUpdateTime: null, // null = no sample yet (fixes skipped first timeupdate)
            lastActualTimeUpdate: 0,
            lastLoggedTime: 0,
            // Watch time is bucketed by the date/hour it was watched, not when it is flushed
            byDate: {} // { [date]: { durationWatched, actualTimeWatched, byHour } }
        });
    }
    // Re-register on every touch so a video detached from the DOM and re-added
    // later is picked up again by the next flush. Log only when the element is
    // actually back in the DOM - a detached-but-still-playing video would
    // otherwise re-log on every purge/re-register cycle.
    if (!trackedVideos.has(video)) {
        if (!isNewVideo && document.contains(video)) {
            console.log('[Video Analytics] Re-registering previously detached video');
        }
        trackedVideos.add(video);
    }
    return videoStates.get(video);
}

// Returns (creating if needed) this video's delta bucket for the current date.
function getDayBucket(state) {
    const date = getTodayDate();
    if (!state.byDate[date]) {
        state.byDate[date] = { durationWatched: 0, actualTimeWatched: 0, byHour: {} };
    }
    return state.byDate[date];
}

function recordContentTime(state, seconds) {
    const bucket = getDayBucket(state);
    bucket.durationWatched += seconds;
    const hour = String(new Date().getHours());
    bucket.byHour[hour] = (bucket.byHour[hour] || 0) + seconds;
}

function recordActualTime(state, seconds) {
    getDayBucket(state).actualTimeWatched += seconds;
}

// Loads the stored history into the in-memory cache once, before any flush runs.
function initializeStorage() {
    chrome.storage.local.get(['videoWatchHistory'], function (result) {
        if (!storageLoaded) {
            cachedHistory = result.videoWatchHistory || {};
            storageLoaded = true;
        }
        console.log(`[Video Analytics] Storage cache loaded (${Object.keys(cachedHistory).length} days)`);
    });
}

// Keep the cache in sync with writes coming from other contexts
// (other frames of this tab, or the popup's import feature).
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.videoWatchHistory && storageLoaded) {
        cachedHistory = changes.videoWatchHistory.newValue || {};
    }
});

// Updates the local storage with the accumulated time watched and resets the counters.
// The merge into cachedHistory is fully synchronous and followed by a single set(),
// so this is safe to call concurrently from pause handlers, the periodic throttle,
// and page-unload handlers without ever interleaving read-modify-write cycles.
function updateStorage() {
    if (!storageLoaded) {
        // Deltas stay in state.byDate and are flushed once storage has loaded.
        console.log('[Video Analytics] Storage cache not loaded yet, deferring flush');
        return;
    }

    // Accumulate time from all tracked videos (including ones no longer in the
    // DOM - their un-flushed time is real and must not be discarded).
    let totalDuration = 0;
    let totalActual = 0;
    const flushedHours = [];
    const dayDeltas = {}; // per-date summary for logging

    for (const video of trackedVideos) {
        const state = videoStates.get(video);
        if (!state) {
            continue;
        }

        // Flush each watched-date bucket to its own day key, so time watched
        // before midnight is never attributed to the next day.
        for (const [date, bucket] of Object.entries(state.byDate)) {
            if (!cachedHistory[date]) {
                cachedHistory[date] = {
                    durationWatched: 0,
                    actualTimeWatched: 0
                };
            }
            const day = cachedHistory[date];
            day.durationWatched += bucket.durationWatched;
            day.actualTimeWatched += bucket.actualTimeWatched;

            if (!day.byHour) {
                day.byHour = {};
            }
            for (const [hour, seconds] of Object.entries(bucket.byHour)) {
                day.byHour[hour] = (day.byHour[hour] || 0) + seconds;
                if (!flushedHours.includes(hour)) {
                    flushedHours.push(hour);
                }
            }

            if (!dayDeltas[date]) {
                dayDeltas[date] = { duration: 0, actual: 0 };
            }
            dayDeltas[date].duration += bucket.durationWatched;
            dayDeltas[date].actual += bucket.actualTimeWatched;
            totalDuration += bucket.durationWatched;
            totalActual += bucket.actualTimeWatched;
        }
        state.byDate = {};
    }

    // Videos removed from the DOM have been flushed above; drop them so detached
    // elements don't leak. getVideoState() re-registers them if they come back.
    let purgedCount = 0;
    for (const video of trackedVideos) {
        if (!document.contains(video)) {
            trackedVideos.delete(video);
            purgedCount++;
        }
    }
    if (purgedCount > 0) {
        console.log(`[Video Analytics] Purged ${purgedCount} detached video(s) after flush`);
    }

    if (totalDuration > 0 || totalActual > 0) {
        chrome.storage.local.set({videoWatchHistory: cachedHistory});
        const perDate = Object.entries(dayDeltas)
            .map(([date, t]) => `${date}: +${t.duration.toFixed(1)}s duration / +${t.actual.toFixed(1)}s actual`)
            .join(', ');
        console.log(`[Video Analytics] Storage updated (${perDate}). Hours:`, flushedHours);
    }
}

// Handles the 'timeupdate' event for videos, updating the watched time.
function handleTimeUpdate(event) {
    const video = event.target;
    const state = getVideoState(video);
    const currentTime = video.currentTime;
    const currentActualTime = Date.now() / 1000; // Convert to seconds

    if (state.lastUpdateTime !== null) {
        const timeDiff = currentTime - state.lastUpdateTime;

        // Only count content-time increments smaller than 4.5 seconds to ignore
        // large skips, and only while actually playing - timeupdate also fires
        // while paused when the user scrubs, which must not count as watch time.
        if (!video.paused) {
            if (timeDiff > 0 && timeDiff < 4.5) {
                recordContentTime(state, timeDiff);
            } else if (timeDiff >= 4.5) {
                console.log(`[Video Analytics] Ignoring ${timeDiff.toFixed(1)}s forward skip (seek)`);
            } else if (timeDiff < 0) {
                console.log(`[Video Analytics] Ignoring ${Math.abs(timeDiff).toFixed(1)}s backward seek`);
            }
        } else if (timeDiff !== 0) {
            console.log(`[Video Analytics] Ignoring ${timeDiff.toFixed(2)}s content change while paused (scrub)`);
        }

        // Update actual time watched only while the video is playing.
        if (!video.paused) {
            const actualTimeDiff = currentActualTime - state.lastActualTimeUpdate;
            if (actualTimeDiff > 0) {
                recordActualTime(state, actualTimeDiff);
            }
        }
    } else {
        console.log(`[Video Analytics] First timeupdate: baseline set at ${currentTime.toFixed(2)}s, counting starts on next update`);
    }

    state.lastUpdateTime = currentTime;
    state.lastActualTimeUpdate = currentActualTime;

    // Log summary every 10 seconds of accumulated time
    const totalDuration = Object.values(state.byDate).reduce((sum, b) => sum + b.durationWatched, 0);
    const totalActual = Object.values(state.byDate).reduce((sum, b) => sum + b.actualTimeWatched, 0);
    if (totalDuration > 0 && Math.floor(totalDuration) % 10 === 0 && Math.floor(totalDuration) !== state.lastLoggedTime) {
        state.lastLoggedTime = Math.floor(totalDuration);
        const videoSrc = video.src || video.currentSrc || 'video';
        console.log(`[Video Analytics] Progress: ${videoSrc} - ${totalDuration.toFixed(1)}s duration, ${totalActual.toFixed(1)}s actual time`);
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
        const state = getVideoState(video);
        const videoSrc = video.src || video.currentSrc || 'unknown source';
        console.log(`[Video Analytics] Attaching listeners to video: ${videoSrc}`);

        // Initialize lastActualTimeUpdate to prevent race condition
        // If video is already playing, timeupdate may fire before play event
        state.lastActualTimeUpdate = Date.now() / 1000;

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('play', function () {
            state.lastActualTimeUpdate = Date.now() / 1000; // Update the last actual time on play.
            console.log(`[Video Analytics] Video started playing: ${videoSrc}`);
        });
        video.addEventListener('pause', function () {
            // Re-fetch state in case the element was detached and re-added.
            const currentState = getVideoState(video);
            const delta = Date.now() / 1000 - currentState.lastActualTimeUpdate;
            if (delta > 0) {
                recordActualTime(currentState, delta);
            }
            currentState.lastActualTimeUpdate = Date.now() / 1000; // Avoid double counting on the next resume.
            const totalDuration = Object.values(currentState.byDate).reduce((sum, b) => sum + b.durationWatched, 0);
            const totalActual = Object.values(currentState.byDate).reduce((sum, b) => sum + b.actualTimeWatched, 0);
            console.log(`[Video Analytics] Video paused. Session: accumulated=${totalDuration.toFixed(1)}s, actual=${totalActual.toFixed(1)}s`);
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
    mutationObserver = new MutationObserver(function (mutations) {
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

    mutationObserver.observe(document.body, {childList: true, subtree: true});

    // Save data and clean up when the page is being unloaded. updateStorage()
    // merges synchronously from the in-memory cache and dispatches a single
    // storage.local.set(), so the final data survives tab teardown.
    function handlePageUnload() {
        console.log('[Video Analytics] Page unloading, saving final data and cleaning up...');
        // Disconnect the observer to prevent memory leaks
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
        updateStorage();
    }
    window.addEventListener('pagehide', handlePageUnload);
    window.addEventListener('beforeunload', handlePageUnload);
}

// Checks for video elements on the page and initializes tracking if found.
function checkForVideos() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
        // Videos found - cancel any pending retry so only one chain ever exists.
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
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
        scheduleRetry();
    }
}

// Schedules at most one pending retry; repeated background signals while a
// retry is pending never create additional parallel chains.
function scheduleRetry() {
    if (retryTimer === null) {
        retryTimer = setTimeout(function () {
            retryTimer = null;
            checkForVideos();
        }, 10000);
        console.log('[Video Analytics] Scheduled single retry in 10 seconds');
    } else {
        // Expected on every background poll for audible pages without videos -
        // debug level keeps the console usable.
        console.debug('[Video Analytics] Retry already pending, skipping duplicate schedule');
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
const isTopFrame = window.top === window;
let pageUrl = 'unknown';
try {
    // Log path only - query strings can carry session tokens.
    pageUrl = window.location.origin + window.location.pathname;
} catch (error) {
    // Cross-origin restriction - keep the 'unknown' fallback
}
console.log(`[Video Analytics] Content script loaded in ${isTopFrame ? 'top frame' : 'iframe'} (${pageUrl}), waiting for background script signal`);
