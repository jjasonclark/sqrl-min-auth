'use strict';

const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const { createUserCookie } = require('../lib/cookie');
const baseUrl = process.env.URL_BASE;
const successUrl = `${baseUrl}/loggedin`;
const sqrlHandler = require('../lib/sqrl');

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');

  const codeParam = get(event, 'queryStringParameters.code');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  logger.info({ codeParam, requestIp }, 'Searching for code');

  const user = await sqrlHandler.useCode(codeParam, requestIp);
  if (user) {
    logger.info({ user, codeParam }, 'Found unused code');
    const returnValue = {
      statusCode: 302,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
        Pragma: 'no-cache',
        Vary: 'Origin',
        'Cache-control': 'no-cache',
        'Content-Length': '0',
        'Set-Cookie': createUserCookie(user.id, baseUrl),
        Location: successUrl
      },
      body: ''
    };
    logger.info({ returnValue }, 'Final return value');
    return returnValue;
  } else {
    logger.info({ codeParam, requestIp }, 'No nut found');
    const returnValue = {
      statusCode: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
        Pragma: 'no-cache',
        Vary: 'Origin',
        'Cache-control': 'no-cache',
        'Content-Length': '0'
      },
      body: ''
    };
    logger.info({ returnValue }, 'Final return value');
    return returnValue;
  }
};

module.exports = { handler };
