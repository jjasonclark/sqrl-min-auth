'use strict';

const logger = require('pino')({ level: 'info' });
const { clearUserCookie } = require('../lib/cookie');
const rootUrl = `${process.env.URL_BASE}/sqrl`;

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');
  const returnValue = {
    statusCode: 302,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
      Pragma: 'no-cache',
      Vary: 'Origin',
      'Cache-control': 'no-cache',
      'Content-Length': '0',
      'Set-Cookie': clearUserCookie(process.env.URL_BASE),
      Location: rootUrl
    },
    body: ''
  };
  logger.info({ returnValue }, 'Final return value');
  return returnValue;
};

module.exports = { handler };
