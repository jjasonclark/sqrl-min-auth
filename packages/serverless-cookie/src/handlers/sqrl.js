'use strict';

const logger = require('pino')({ level: 'debug' });
const get = require('dlv');
const sqrlHandler = require('../lib/sqrl-handler');

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const ip = get(event, 'requestContext.identity.sourceIp');
  const nut = get(event, 'queryStringParameters.nut');
  const body = get(event, 'body');
  logger.debug({ ip, nut, body }, 'Request parameters');
  const sqrlResult = await sqrlHandler.handler(ip, nut, body);
  logger.debug({ sqrlResult }, 'SQRL result');
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
      Pragma: 'no-cache',
      Vary: 'Origin',
      'Cache-control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': sqrlResult.length.toString()
    },
    body: sqrlResult
  };
};

module.exports = { handler };
