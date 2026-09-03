'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
    localDateStr,
    localHourStr,
    makeVideo,
    createContentSandbox,
} = require('./helpers');

// Boots a sandbox with storage loaded (initializeStorage resolved).
async function bootSandbox(options = {}) {
    const sb = createContentSandbox(options);
    sb.sandbox.initializeStorage();
    await sb.tick();
    return sb;
}

function timeupdate(sb, video) {
    sb.sandbox.handleTimeUpdate({ target: video });
}

test('getTodayDate returns the fake clock date in YYYY-MM-DD local format', () => {
    const sb = createContentSandbox({ startMs: Date.UTC(2026, 8, 3, 12, 0, 0) });
    const today = sb.sandbox.getTodayDate();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(today, localDateStr(sb.clock.now()));
});

test('fix 10: video starting at 0:00 counts every increment (no skipped first timeupdate)', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v); // t=0 baseline
    v.currentTime = 0.25;
    timeupdate(sb, v); // +0.25
    v.currentTime = 0.5;
    timeupdate(sb, v); // +0.25

    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 1);
    const today = localDateStr(sb.clock.now());
    assert.ok(Math.abs(sb.setCalls[0].videoWatchHistory[today].durationWatched - 0.5) < 1e-9);
});

test('fix 5: scrubbing a paused video records no watch time', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 10, paused: true });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 11; // seek while paused (timeupdate still fires)
    timeupdate(sb, v);

    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 0); // nothing recorded -> no flush at all
});

test('skips larger than 4.5s are not counted as watch time', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 10, paused: false });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 20; // big forward skip
    timeupdate(sb, v);

    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 0);
});

test('flush writes {durationWatched, actualTimeWatched, byHour} and resets buckets (second flush is a no-op)', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 5, paused: false });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 5.5;
    timeupdate(sb, v);

    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 1);
    const today = localDateStr(sb.clock.now());
    const hour = localHourStr(sb.clock.now());
    const day = sb.setCalls[0].videoWatchHistory[today];
    assert.equal(day.durationWatched, 0.5);
    assert.equal(day.byHour[hour], 0.5);

    sb.sandbox.updateStorage(); // buckets were reset
    assert.equal(sb.setCalls.length, 1, 'empty second flush must not write again');
});

test('fix 1: consecutive flushes never lose deltas (no read-modify-write race)', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 1;
    timeupdate(sb, v);
    sb.sandbox.updateStorage(); // flush 1: +1s

    v.currentTime = 3;
    timeupdate(sb, v);
    sb.sandbox.updateStorage(); // flush 2 fires while "in flight" - must stack, not clobber

    const today = localDateStr(sb.clock.now());
    assert.equal(sb.setCalls.length, 2);
    assert.ok(Math.abs(sb.setCalls[0].videoWatchHistory[today].durationWatched - 1) < 1e-9);
    assert.ok(Math.abs(sb.setCalls[1].videoWatchHistory[today].durationWatched - 3) < 1e-9);
    assert.ok(Math.abs(sb.storeData.videoWatchHistory[today].durationWatched - 3) < 1e-9);
});

test('fix 3: detached video is flushed, then purged; re-added video is tracked again', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.videosInDom.add(v);
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 2;
    timeupdate(sb, v);

    sb.videosInDom.delete(v); // SPA removes the element before any flush
    sb.sandbox.updateStorage();
    const today = localDateStr(sb.clock.now());
    assert.ok(Math.abs(sb.storeData.videoWatchHistory[today].durationWatched - 2) < 1e-9,
        'un-flushed time of removed video must be persisted');

    sb.sandbox.updateStorage(); // video purged and buckets reset -> no-op
    assert.equal(sb.setCalls.length, 1, 'flush after purge must not write again');

    // Element re-added to the DOM: getVideoState must re-register it.
    sb.videosInDom.add(v);
    sb.sandbox.getVideoState(v);
    v.currentTime = 3;
    timeupdate(sb, v);
    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 2);
    const last = sb.setCalls[sb.setCalls.length - 1].videoWatchHistory[today];
    assert.ok(Math.abs(last.durationWatched - 3) < 1e-9, 're-added video time must flush again');
});

test('fix 9: time is attributed to the date/hour it was watched, not flushed', async () => {
    // Start 2s before local midnight.
    const midnight = new Date();
    midnight.setHours(23, 59, 58, 0);
    const sb = await bootSandbox({ startMs: midnight.getTime() });
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);

    const day1 = localDateStr(sb.clock.now());
    const hour23 = localHourStr(sb.clock.now());

    // Record 2s before midnight...
    timeupdate(sb, v);
    v.currentTime = 2;
    timeupdate(sb, v);

    // ...then cross midnight and record 2s more.
    sb.clock.advance(5000);
    v.currentTime = 4;
    timeupdate(sb, v);

    const day2 = localDateStr(sb.clock.now());
    const hour0 = localHourStr(sb.clock.now());
    assert.notEqual(day1, day2, 'clock must have crossed local midnight');

    sb.sandbox.updateStorage();
    const history = sb.storeData.videoWatchHistory;
    assert.ok(Math.abs(history[day1].durationWatched - 2) < 1e-9,
        'pre-midnight seconds must land on day 1');
    assert.ok(Math.abs(history[day2].durationWatched - 2) < 1e-9,
        'post-midnight seconds must land on day 2');
    // byHour: hour 23 on day1, new hour on day2
    assert.equal(history[day1].byHour[hour23], 2);
    assert.equal(history[day1].byHour[hour0], undefined);
    assert.equal(history[day2].byHour[hour0], 2);
});

test('actual time accrues from wall clock across play/pause (pause flushes synchronously)', async () => {
    const sb = await bootSandbox();
    const v = makeVideo({ paused: true });
    sb.sandbox.attachListenersToVideo(v);

    v.dispatch('play');
    sb.clock.advance(10_000); // 10 real seconds of playback
    const setCallsBeforePause = sb.setCalls.length;
    v.dispatch('pause');

    const today = localDateStr(sb.clock.now());
    // pause handler flushes synchronously - no microtask wait allowed (fix 2)
    assert.equal(sb.setCalls.length, setCallsBeforePause + 1);
    assert.ok(Math.abs(sb.storeData.videoWatchHistory[today].actualTimeWatched - 10) < 1e-9);
});

test('fix 2: pagehide flushes accumulated time synchronously', async () => {
    const sb = createContentSandbox();
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.videosInDom.add(v);
    sb.sandbox.initializeTracking(); // registers pagehide + beforeunload listeners
    await sb.tick(); // let initializeStorage resolve

    assert.ok(sb.windowListeners.pagehide, 'pagehide listener must be registered');
    assert.ok(sb.windowListeners.beforeunload, 'beforeunload listener must be registered');

    sb.sandbox.getVideoState(v);
    timeupdate(sb, v);
    v.currentTime = 4;
    timeupdate(sb, v);

    const before = sb.setCalls.length;
    sb.sandbox.window.dispatch('pagehide');
    assert.equal(sb.setCalls.length, before + 1, 'unload flush must not depend on async callbacks');

    const today = localDateStr(sb.clock.now());
    assert.ok(Math.abs(sb.storeData.videoWatchHistory[today].durationWatched - 4) < 1e-9);
});

test('updateStorage waits for storage to load before flushing (storageLoaded gate)', async () => {
    const sb = createContentSandbox({ holdStorageGets: true });
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);

    timeupdate(sb, v);
    v.currentTime = 1.5;
    timeupdate(sb, v);

    sb.sandbox.updateStorage();
    assert.equal(sb.setCalls.length, 0, 'must not write before the initial get resolves');

    sb.sandbox.initializeStorage();
    sb.releaseGets();
    sb.sandbox.updateStorage();

    const today = localDateStr(sb.clock.now());
    assert.equal(sb.setCalls.length, 1);
    assert.ok(Math.abs(sb.storeData.videoWatchHistory[today].durationWatched - 1.5) < 1e-9);
});

test('onChanged keeps the cache in sync with external writes (popup import)', async () => {
    const sb = await bootSandbox();
    assert.equal(sb.onChangedListeners.length, 1);

    const imported = { videoWatchHistory: { '2026-01-01': { durationWatched: 100, actualTimeWatched: 80 } } };
    sb.onChangedListeners[0]({ videoWatchHistory: { newValue: imported.videoWatchHistory } }, 'local');

    // Next flush must build on top of the imported data, not clobber it.
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);
    timeupdate(sb, v);
    v.currentTime = 2;
    timeupdate(sb, v);
    sb.sandbox.updateStorage();

    const today = localDateStr(sb.clock.now());
    const history = sb.storeData.videoWatchHistory;
    assert.equal(history['2026-01-01'].durationWatched, 100, 'imported day must survive');
    assert.ok(Math.abs(history[today].durationWatched - 2) < 1e-9);
});

test('pre-existing storage data is preserved and accumulated onto', async () => {
    const today = localDateStr(Date.now());
    const sb = await bootSandbox({
        storage: { videoWatchHistory: { [today]: { durationWatched: 50, actualTimeWatched: 40 } } },
    });
    const v = makeVideo({ currentTime: 0, paused: false });
    sb.sandbox.getVideoState(v);
    timeupdate(sb, v);
    v.currentTime = 3;
    timeupdate(sb, v);
    sb.sandbox.updateStorage();

    const day = sb.storeData.videoWatchHistory[today];
    assert.ok(Math.abs(day.durationWatched - 53) < 1e-9);
    assert.ok(Math.abs(day.actualTimeWatched - 40) < 1e-9);
});
