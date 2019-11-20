'use strict';

const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const cookie = require('cookie');

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const cookies = get(event, 'headers.Cookie', '');
  const userCookies = get(cookie.parse(cookies), 'user');
  logger.debug({ cookies, userCookies }, 'Found cookies');
  const logoutUrl = `${process.env.URL_BASE}/logout`;
  const rootUrl = `${process.env.URL_BASE}/sqrl`;

  if (!userCookies) {
    const errorReturn = {
      statusCode: 302,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
        Pragma: 'no-cache',
        Vary: 'Origin',
        'Cache-control': 'no-cache',
        'Content-Length': '0',
        Location: rootUrl
      },
      body: ''
    };
    logger.info({ errorReturn }, 'Error return value');
    return errorReturn;
  }
  const body = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>SQRL-Min-Auth</title>
    </head>
    <body>
      <div>You are user ${userCookies}</di>
      <form action="${logoutUrl}" method="post">
        <input type="submit" value="Logout" />
      </form>
    </body>
  </html>`;
  const returnValue = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
      Pragma: 'no-cache',
      Vary: 'Origin',
      'Cache-control': 'no-cache',
      'Content-Type': 'text/html;charset=utf-8',
      'Content-Length': body.length.toString()
    },
    body
  };
  logger.info({ returnValue }, 'Final return value');
  return returnValue;
};

module.exports = { handler };
