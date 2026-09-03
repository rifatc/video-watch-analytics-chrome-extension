'use strict';

// Test harness: loads the extension scripts into a vm sandbox with mocked
// chrome.*, document, window and a controllable clock, so their logic can be
// exercised deterministically without a browser.

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Same local-time formatting as content.js getTodayDate(), used for expectations.
function localDateStr(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localHourStr(ms) {
    return String(new Date(ms).getHours());
}

// A replaceable Date class whose "now" the tests control.
function createFakeClock(startMs) {
    let nowMs = startMs;
    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) {
                super(nowMs);
            } else {
                super(...args);
            }
        }
        static now() {
            return nowMs;
        }
    }
    return {
        Date: FakeDate,
        now: () => nowMs,
        advance: (ms) => { nowMs += ms; },
        set: (ms) => { nowMs = ms; },
    };
}

// Minimal stand-in for an HTMLVideoElement with captured event listeners.
function makeVideo(overrides = {}) {
    const video = {
        currentTime: 0,
        paused: true,
        src: 'test-video.mp4',
        currentSrc: 'test-video.mp4',
        ...overrides,
    };
    video._listeners = {};
    video.addEventListener = (type, fn) => {
        (video._listeners[type] ||= []).push(fn);
    };
    video.dispatch = (type) => {
        for (const fn of video._listeners[type] || []) {
            fn({ target: video });
        }
    };
    video.hasAttribute = () => false;
    video.setAttribute = () => {};
    return video;
}

function loadScript(filename, sandbox) {
    const code = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    vm.runInContext(code, sandbox, { filename });
}

// Loads content.js. Storage get() callbacks are async (like the real API) and
// can be held back via holdStorageGets + releaseGets() to test the
// storageLoaded gate. Pass fakeTimers: true to get recording setTimeout/
// clearTimeout stubs (needed for retry-chain tests - real 10s timers would
// hang or slow the run).
function createContentSandbox({ startMs = Date.now(), storage = {}, holdStorageGets = false, fakeTimers = false } = {}) {
    const clock = createFakeClock(startMs);
    const setCalls = []; // deep snapshots of every chrome.storage.local.set payload
    const storeData = JSON.parse(JSON.stringify(storage));
    const pendingGets = [];
    const windowListeners = {};
    const onChangedListeners = [];
    const videosInDom = new Set();

    const chrome = {
        storage: {
            local: {
                get(keys, cb) {
                    const result = {};
                    for (const k of keys) {
                        if (k in storeData) result[k] = storeData[k];
                    }
                    if (holdStorageGets) {
                        pendingGets.push(() => cb(result));
                    } else {
                        queueMicrotask(() => cb(result));
                    }
                },
                set(obj) {
                    const snapshot = JSON.parse(JSON.stringify(obj));
                    Object.assign(storeData, snapshot);
                    setCalls.push(snapshot);
                },
            },
            onChanged: {
                addListener(fn) { onChangedListeners.push(fn); },
            },
        },
        runtime: { onMessage: { addListener() {} } },
    };

    const document = {
        contains: (el) => videosInDom.has(el),
        getElementsByTagName: (tag) => (tag === 'video' ? [...videosInDom] : []),
        body: {},
    };

    const timers = { scheduled: [], cleared: [] };

    const sandbox = {
        console: { log() {}, warn() {}, error() {}, debug() {} },
        chrome,
        Date: clock.Date,
        document,
        window: {
            addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
            dispatch(type) {
                for (const fn of windowListeners[type] || []) fn();
            },
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        setTimeout: fakeTimers
            ? (fn, ms) => {
                  const id = { fn, ms };
                  timers.scheduled.push(id);
                  return id;
              }
            : setTimeout,
        clearTimeout: fakeTimers
            ? (id) => {
                  timers.cleared.push(id);
                  const index = timers.scheduled.indexOf(id);
                  if (index !== -1) timers.scheduled.splice(index, 1);
              }
            : clearTimeout,
    };

    vm.createContext(sandbox);
    loadScript('content.js', sandbox);

    return {
        sandbox,
        clock,
        setCalls,
        storeData,
        videosInDom,
        windowListeners,
        onChangedListeners,
        timers,
        // Emulates the timer firing: real timers leave the pending set before
        // the callback runs, so remove it before invoking.
        fireTimer(id) {
            const index = timers.scheduled.indexOf(id);
            if (index !== -1) timers.scheduled.splice(index, 1);
            id.fn();
        },
        releaseGets() {
            while (pendingGets.length) pendingGets.shift()();
        },
        tick: () => new Promise((resolve) => queueMicrotask(resolve)),
    };
}

// Loads popup.js with just enough DOM/storage stubbing to expose its pure
// helpers (formatTime) without executing UI handlers.
function createPopupSandbox() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        alert() {},
        chrome: { storage: { local: { get() {} } } },
        document: {
            addEventListener() {},
            getElementById() { return null; },
        },
    };
    vm.createContext(sandbox);
    loadScript('popup.js', sandbox);
    return { sandbox };
}

// Loads background.js with a controllable chrome.tabs mock.
function createBackgroundSandbox() {    const sentMessages = [];
    const tabs = {
        _audible: false,
        _rejectSend: false,
        getCalls: [],
        get(tabId, cb) {
            this.getCalls.push(tabId);
            cb({ id: tabId, audible: this._audible });
        },
        sendMessage(tabId, message) {
            sentMessages.push({ tabId, message });
            return this._rejectSend
                ? Promise.reject(new Error('Receiving end does not exist'))
                : Promise.resolve();
        },
        onUpdated: { addListener(fn) { this._onUpdated = fn; } },
        onActivated: { addListener(fn) { this._onActivated = fn; } },
        query(opts, cb) { cb([{ id: 1, audible: this._audible }]); },
    };

    const sandbox = {
        console: { log() {}, warn() {}, error() {}, debug() {} },
        chrome: { tabs, runtime: { lastError: null } },
        setInterval: () => 0,
        clearInterval() {},
    };

    vm.createContext(sandbox);
    loadScript('background.js', sandbox);
    return { sandbox, tabs, sentMessages };
}

module.exports = {
    localDateStr,
    localHourStr,
    createFakeClock,
    makeVideo,
    createContentSandbox,
    createBackgroundSandbox,
    createPopupSandbox,
};
