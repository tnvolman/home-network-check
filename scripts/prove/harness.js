'use strict';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}\n${error && error.stack ? error.stack : error}`);
  }
}

function finish() {
  console.log('---');
  console.log(`passed ${passed}`);
  console.log(`failed ${failures.length}${failures.length ? `: ${failures.join(', ')}` : ''}`);
  if (failures.length) process.exit(1);
}

module.exports = { check, checkAsync, finish };
