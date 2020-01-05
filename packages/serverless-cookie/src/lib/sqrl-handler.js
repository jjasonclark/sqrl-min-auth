'use strict';

const logger = require('pino')({ level: 'debug' });
const { createSQRLHandler } = require('sqrl-protocol');
const PgSqrlStore = require('pg-sqrl-store');

const baseUrl = process.env.URL_BASE;
const connectionString = process.env.POSTGRES_CONNECTION_STRING;
const hmacSecret = process.env.HMAC_SECRET;
const blowfishSecrets = {
  key: process.env.BLOWFISH_KEY,
  iv: process.env.BLOWFISH_IV
};

const sqrlHandler = createSQRLHandler({
  baseUrl,
  logger,
  store: new PgSqrlStore(connectionString),
  hmacSecret,
  blowfishSecrets
});

module.exports = sqrlHandler;
