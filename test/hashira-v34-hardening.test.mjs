// The palette now comes only from the kit's tokens.css. When the kit is missing (a fixture build,
// which writes no _kit/, or a kit that failed to load) the page must still be readable: the body
// falls back to the browser's system colours and font, never to a palette of its own, and the
// page sets no color-scheme, so the kit's theme stays the one that rules once it loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { top } from '../src/render.mjs';

const css = (up) => /<style>([\s\S]*?)<\/style>/.exec(top({ org: 'skathio', title: 't', description: 'd', up, hasReleases: true }))[1].replace(/\s+/g, '');
const bodyRule = (sheet) => /(?:^|})body\{([^}]*)\}/.exec(sheet)?.[1] ?? null;

test('without the kit the body falls back to system colours and font, not to undefined tokens', () => {
  for (const up of ['', '../']) {
    const rule = bodyRule(css(up));
    assert.ok(rule, 'a body rule');
    const decls = Object.fromEntries(rule.split(';').filter(Boolean).map((d) => d.split(/:(.*)/s).slice(0, 2)));
    assert.equal(decls.background, 'var(--canvas,Canvas)');
    assert.equal(decls.color, 'var(--ink,CanvasText)');
    assert.equal(decls.font, '16px/1.6var(--sans,system-ui,sans-serif)');
    assert.equal(decls.margin, '0');
  }
});

test('the page declares no color-scheme of its own, so the kit\'s theme rules', () => {
  for (const up of ['', '../']) assert.ok(!/(^|[;{])color-scheme:/.test(css(up)));
});
