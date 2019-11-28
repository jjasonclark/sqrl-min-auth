'use strict';

const nullLogger = () => ({
  info() {},
  warn() {},
  error() {},
  debug() {}
});

module.exports = { nullLogger };
