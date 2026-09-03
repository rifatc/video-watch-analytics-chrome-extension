'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeVideo, createContentSandbox } = require('./helpers');

test('fix 7: repeated signals while a retry is pending create at most one chain', () => {
    const sb = createContentSandbox({ fakeTimers: true });

    // No videos in DOM -> schedules exactly one retry.
    sb.sandbox.startTracking();
    assert.equal(sb.timers.scheduled.length, 1);
    assert.equal(sb.timers.scheduled[0].ms, 10000);

    // More background signals while pending must not stack chains.
    sb.sandbox.startTracking();
    sb.sandbox.startTracking();
    sb.sandbox.startTracking();
    assert.equal(sb.timers.scheduled.length, 1, 'duplicate signals must not add retry chains');
});

test('fix 7: pending retry is cancelled once videos are found', () => {
    const sb = createContentSandbox({ fakeTimers: true });

    sb.sandbox.startTracking(); // no videos -> one pending retry
    assert.equal(sb.timers.scheduled.length, 1);

    const v = makeVideo({ paused: true });
    sb.videosInDom.add(v);
    sb.sandbox.startTracking(); // videos found -> cancels pending timer, initializes

    assert.equal(sb.timers.scheduled.length, 0, 'pending retry must be cancelled');
    assert.equal(sb.timers.cleared.length, 1);
    assert.ok(v._listeners.timeupdate, 'video should have listeners attached');
});

test('fix 7: fired retry on a video-less page schedules exactly one successor', () => {
    const sb = createContentSandbox({ fakeTimers: true });

    sb.sandbox.startTracking(); // schedules retry #1
    const first = sb.timers.scheduled[0];

    sb.fireTimer(first); // timer fires, still no videos -> schedules retry #2

    assert.equal(sb.timers.scheduled.length, 1, 'exactly one successor chain');
    assert.notEqual(sb.timers.scheduled[0], first, 'successor must be a new timer');
});
