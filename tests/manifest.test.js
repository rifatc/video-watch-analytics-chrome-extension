'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')
);

test('fix 4: content scripts are injected into all frames', () => {
    assert.ok(Array.isArray(manifest.content_scripts));
    assert.equal(manifest.content_scripts.length, 1);
    assert.equal(manifest.content_scripts[0].all_frames, true);
    assert.deepEqual(manifest.content_scripts[0].matches, ['<all_urls>']);
});
