'use strict';

const url = require('url');
const logger = require('pino')({ level: 'info' });
const cookie = require('cookie');
const apiBaseUrl = new url.URL(process.env.URL_BASE);

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
      'Set-Cookie': cookie.serialize('user', '', {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: apiBaseUrl.pathname,
        domain: apiBaseUrl.hostname,
        expires: new Date('Sun, 06 Nov 1994 08:49:37 GMT')
      }),
      Location: `${apiBaseUrl}/sqrl`
    },
    body: ''
  };
  logger.info({ returnValue }, 'Final return value');
  return returnValue;
};

module.exports = { handler };
