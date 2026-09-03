'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBackgroundSandbox } = require('./helpers');

test('sends checkForVideo only to audible tabs (audible gate on all paths)', () => {
    const { sandbox, tabs, sentMessages } = createBackgroundSandbox();

    tabs._audible = true;
    sandbox.chrome.tabs.onUpdated._onUpdated(1, { audible: true }, {});
    assert.equal(sentMessages.length, 1);
    assert.deepEqual(sentMessages[0].message, { action: 'checkForVideo' });
    assert.deepEqual(sentMessages[0].tabId, 1);

    tabs._audible = false;
    sandbox.chrome.tabs.onActivated._onActivated({ tabId: 2 });
    assert.equal(sentMessages.length, 1, 'silent tab activation must not be messaged');
});

test('fix 6: rejected sendMessage promise is swallowed (no unhandled rejection)', async () => {
    const { sandbox, tabs } = createBackgroundSandbox();
    tabs._audible = true;
    tabs._rejectSend = true; // simulates tab without content script

    sandbox.chrome.tabs.onUpdated._onUpdated(1, { audible: true }, {});

    // If .catch were missing, this would crash the test run with an
    // unhandled rejection. Give the microtask queue a chance to surface it.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(true);
});

test('onUpdated ignores updates without an audible field', () => {
    const { sandbox, tabs, sentMessages } = createBackgroundSandbox();
    tabs._audible = true;

    sandbox.chrome.tabs.onUpdated._onUpdated(1, { status: 'loading' }, {});
    assert.equal(sentMessages.length, 0, 'no audible change -> no message');
});
