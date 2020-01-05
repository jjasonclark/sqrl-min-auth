'use strict';

const logger = require('pino')({ level: 'debug' });
const { createSQRLHandler } = require('sqrl-protocol');
const PgSqrlStore = require('pg-sqrl-store');
const secrets = require('../../secrets.json');

const baseUrl = process.env.URL_BASE;
const connectionString = process.env.POSTGRES_CONNECTION_STRING;

const sqrlHandler = createSQRLHandler({
  baseUrl,
  logger,
  store: new PgSqrlStore(connectionString, { logger }),
  hmacSecret: secrets.nuts.hmac,
  blowfishSecrets: {
    key: secrets.nuts.key,
    iv: secrets.nuts.iv
  }
});

module.exports = sqrlHandler;
