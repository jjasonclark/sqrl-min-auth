'use strict';

const logger = require('pino')({ level: 'debug' });
const { createSQRLHandler } = require('./sqrl-protocol');
const sqrlCrud = require('./db/sqrl');
const nutCrud = require('./db/nut');
const userCrud = require('./db/user');
const secrets = require('../../secrets.json');
const baseUrl = process.env.URL_BASE;

const apiBaseUrl = new url.URL(baseUrl);
const sqrlHandler = createSQRLHandler({
  baseUrl,
  logger,
  sqrlCrud,
  nutCrud,
  userCrud,
  sqrlProtoUrl: `sqrl://${apiBaseUrl.hostname}${path}`,
  hmacSecret: secrets.nuts.hmac
});

module.exports = sqrlHandler;
