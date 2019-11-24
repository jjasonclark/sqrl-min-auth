'use strict';

const logger = require('pino')({ level: 'debug' });
const { createSQRLHandler } = require('./sqrl-protocol');
const sqrlCrud = require('./db/sqrl');
const nutCrud = require('./db/nut');
const userCrud = require('./db/user');
const baseUrl = process.env.URL_BASE;

const sqrlHandler = createSQRLHandler({
  baseUrl,
  logger,
  sqrlCrud,
  nutCrud,
  userCrud
});

module.exports = sqrlHandler;
