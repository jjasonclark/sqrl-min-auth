'use strict';

const url = require('url');
const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const cookie = require('cookie');
const { useCode } = require('../lib/db/nut');
const successUrl = `${process.env.URL_BASE}/loggedin`;
const apiBaseUrl = new url.URL(process.env.URL_BASE);
const cookieTimeout = 2 * 7 * 24 * 60 * 60 * 1000; // 2 weeks
const domainName = apiBaseUrl.hostname;

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');

  const codeParam = get(event, 'queryStringParameters.code');
  const allowCookie = get(event, 'queryStringParameters.ac');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  logger.info({ codeParam, requestIp }, 'Searching for code');

  if (allowCookie) {
    const cookies = get(event, 'headers.Cookie', '');
    const userCookie = get(cookie.parse(cookies), 'user');
    logger.debug({ cookies, userCookie }, 'Found cookies');
    if (userCookie) {
      const errorReturn = {
        statusCode: 302,
        headers: {
          'Access-Control-Allow-Origin': '*',
          // Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
          Pragma: 'no-cache',
          Vary: 'Origin',
          'Cache-control': 'no-cache',
          'Content-Length': '0',
          Location: successUrl
        },
        body: ''
      };
      logger.info({ errorReturn }, 'Error return value');
      return errorReturn;
    }
  }

  const foundNut = await useCode(codeParam, requestIp);
  if (foundNut) {
    logger.info({ foundNut, codeParam }, 'Found unused code');
    const returnValue = {
      statusCode: 302,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
        Pragma: 'no-cache',
        Vary: 'Origin',
        'Cache-control': 'no-cache',
        'Content-Length': '0',
        'Set-Cookie': cookie.serialize('user', foundNut.user_id, {
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
          path: apiBaseUrl.pathname,
          domain: domainName,
          expires: new Date(Date.now() + cookieTimeout)
        }),
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
