'use strict';

const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const sqrlHandler = require('../lib/sqrl');

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  const inputNut = get(event, 'queryStringParameters.nut');
  const body = get(event, 'body');
  logger.debug({ requestIp, inputNut, body }, 'Request parameters');
  const sqrlResult = await sqrlHandler.handler(requestIp, inputNut, body);
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
