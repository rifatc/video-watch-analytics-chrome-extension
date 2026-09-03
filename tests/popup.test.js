'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPopupSandbox } = require('./helpers');

// Negative time saved is reachable even at faster playback (stalls accrue
// wall-clock actual time with no content time; sub-1x segments; discarded
// >4.5s increments). formatTime must render negatives correctly instead of
// the old "Math.floor toward -Infinity" garbage.
test('formatTime renders durations and negative time saved correctly', () => {
    const { sandbox } = createPopupSandbox();
    const formatTime = sandbox.formatTime;

    assert.equal(formatTime(0), '0h 0m 0s');
    assert.equal(formatTime(3661), '1h 1m 1s');
    assert.equal(formatTime(59.9), '0h 0m 59s');
    assert.equal(formatTime(3600), '1h 0m 0s');

    // The bug-12 cases: magnitudes must match |seconds| with a single sign.
    assert.equal(formatTime(-10), '-0h 0m 10s');
    assert.equal(formatTime(-3661), '-1h 1m 1s');
    assert.equal(formatTime(-7200), '-2h 0m 0s');
});

// Bug 11: the old import merge accepted negatives, numeric strings, Infinity
// (JSON 1e400), arrays, and arbitrary byHour keys, corrupting stored totals.
test('import rejects negative, non-finite, and non-numeric values', () => {
    const { sandbox } = createPopupSandbox();
    const history = {
        '2026-01-01': { durationWatched: 1000, actualTimeWatched: 800 },
    };

    const count = sandbox.mergeImportedHistory(history, { data: {
        // Negatives must not reduce existing totals (old code turned 1000 into 500).
        '2026-01-01': { durationWatched: -500, actualTimeWatched: -100 },
        // Infinity (from JSON "1e400") and numeric strings must be rejected.
        '2026-01-02': { durationWatched: Infinity, actualTimeWatched: '5' },
        // Array and boolean values must be rejected.
        '2026-01-03': { durationWatched: [5] },
        '2026-01-04': { durationWatched: true },
        // Invalid date format must be skipped.
        'not-a-date': { durationWatched: 10 },
        // A day with only garbage must not be created as a zero entry.
        '2026-01-05': { byHour: { banana: 5, '25': 7, '8': -3 } },
    }});

    assert.equal(count, 0);
    assert.equal(history['2026-01-01'].durationWatched, 1000, 'negative import must not reduce totals');
    assert.equal(history['2026-01-02'], undefined);
    assert.equal(history['2026-01-03'], undefined);
    assert.equal(history['2026-01-04'], undefined);
    assert.equal(history['not-a-date'], undefined);
    assert.equal(history['2026-01-05'], undefined, 'garbage-only day must be skipped entirely');
});

test('import merges valid data, validates byHour keys, canonicalizes zero-padded hours', () => {
    const { sandbox } = createPopupSandbox();
    const history = {
        '2026-02-01': { durationWatched: 50, actualTimeWatched: 40, byHour: { '10': 50 } },
        '2026-02-02': { durationWatched: 10, actualTimeWatched: 10 }, // legacy day, no byHour
    };

    const count = sandbox.mergeImportedHistory(history, { data: {
        '2026-02-01': { durationWatched: 25, actualTimeWatched: 20, byHour: { '10': 10, '11': 15 } },
        '2026-02-02': { byHour: { '08': 5, '9': 4 } }, // "08" must merge into "8"
        '2026-02-03': { durationWatched: 30.5, actualTimeWatched: 20.25 },
    }});

    assert.equal(count, 3);
    assert.equal(history['2026-02-01'].durationWatched, 75);
    assert.deepEqual(history['2026-02-01'].byHour, { '10': 60, '11': 15 });
    assert.deepEqual(history['2026-02-02'].byHour, { '8': 5, '9': 4 }, 'zero-padded hour keys must be canonicalized');
    assert.equal(history['2026-02-03'].durationWatched, 30.5);
    assert.equal(history['2026-02-03'].actualTimeWatched, 20.25);
});

test('import keeps valid fields of a partially-corrupt day and skips nothing valid', () => {
    const { sandbox } = createPopupSandbox();
    const history = {};

    const count = sandbox.mergeImportedHistory(history, { data: {
        // durationWatched invalid, byHour partially valid, actualTimeWatched valid.
        '2026-03-01': {
            durationWatched: null,
            actualTimeWatched: 42,
            byHour: { '7': 100, 'x': 1, '24': 1, '7.5': 1, '8': 2.5 },
        },
    }});

    assert.equal(count, 1);
    const day = history['2026-03-01'];
    assert.equal(day.actualTimeWatched, 42);
    assert.equal(day.durationWatched, 0);
    assert.deepEqual(day.byHour, { '7': 100, '8': 2.5 }, 'invalid hour keys/seconds must be dropped, valid kept');
});

test('import rejects absurd magnitudes that would sum to Infinity', () => {
    const { sandbox } = createPopupSandbox();
    const history = {};

    // Each value is finite and passes per-day validation, but 1e308 + 1e308
    // overflows to Infinity - the same poison-total symptom bug 11 was meant
    // to kill. The 1e9 magnitude cap must reject them.
    const count = sandbox.mergeImportedHistory(history, { data: {
        '2026-01-01': { durationWatched: 1e308 },
        '2026-01-02': { durationWatched: 1e308 },
        '2026-01-03': { durationWatched: 1e9 + 1 }, // just over the cap
    }});

    assert.equal(count, 0);
    assert.deepEqual(history, {});
});

test('import skips all-zero days (no pollution, no counter inflation)', () => {
    const { sandbox } = createPopupSandbox();
    const history = { '2026-01-01': { durationWatched: 100, actualTimeWatched: 80 } };

    const count = sandbox.mergeImportedHistory(history, { data: {
        '2026-01-01': { durationWatched: 0, actualTimeWatched: 0 }, // zeros add nothing
        '2026-01-02': { durationWatched: 0 }, // zero-only day
        '2026-01-03': { byHour: { '8': 0 } }, // zero-only byHour
    }});

    assert.equal(count, 0);
    assert.deepEqual(Object.keys(history), ['2026-01-01'], 'zero days must not create entries');
});

test('import rejects non-calendar dates that would scramble popup sorting', () => {
    const { sandbox } = createPopupSandbox();
    const history = {};

    const count = sandbox.mergeImportedHistory(history, { data: {
        '2026-13-45': { durationWatched: 10 }, // regex-valid, not a real date
        '2026-02-30': { durationWatched: 10 }, // Feb 30 rolls over to March
        '2023-02-29': { durationWatched: 10 }, // not a leap year
        '2024-02-29': { durationWatched: 10 }, // leap year - must be accepted
    }});

    assert.equal(count, 1);
    assert.deepEqual(Object.keys(history), ['2024-02-29']);
});

test('import is safe against __proto__ and constructor byHour keys', () => {
    const { sandbox } = createPopupSandbox();
    const history = {};

    const count = sandbox.mergeImportedHistory(history, { data: {
        '2026-01-01': {
            durationWatched: 5,
            byHour: { '__proto__': 100, 'constructor': 5, 'hasOwnProperty': 3, '8': 2 },
        },
    }});

    assert.equal(count, 1);
    const byHour = history['2026-01-01'].byHour;
    assert.deepEqual(Object.getOwnPropertyNames(byHour), ['8'],
        'dangerous keys must not become own properties');
    assert.ok(byHour.hasOwnProperty('8'),
        'prototype must be intact (prototype replacement would break inherited methods)');
});

test('import of array-shaped data merges nothing', () => {
    const { sandbox } = createPopupSandbox();
    const history = {};

    // typeof [] === 'object', so the old outer check let arrays through;
    // Object.entries yields index keys that only the date regex defused.
    const count = sandbox.mergeImportedHistory(history, { data: ['not', 'dates'] });

    assert.equal(count, 0);
    assert.deepEqual(history, {});
});
