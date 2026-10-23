'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { check } = require('./harness');
const { root } = require('./fixtures');

check('server modules stay under 300 lines and hold no credentials', () => {
  const stack = [path.join(root, 'server')];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (name.endsWith('.js')) {
        const text = fs.readFileSync(full, 'utf8');
        const lines = text.split('\n').length;
        assert.ok(lines <= 300, `${path.relative(root, full)} has ${lines} lines`);
        assert.ok(!/api[_-]?key|secret|BEGIN [A-Z ]*PRIVATE|password\s*[:=]/i.test(text), full);
      }
    }
  }
});
