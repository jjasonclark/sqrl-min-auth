'use strict';

const logger = require('pino')({ level: 'debug' });
const get = require('dlv');
const { useCode } = require('../lib/db/nut');

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');

  const codeParam = get(event, 'queryStringParameters.code');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  const foundNut = await useCode(codeParam, requestIp);
  let body;
  if (foundNut) {
    logger.info({ foundNut, codeParam }, 'Found unused code');
    body = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>SQRL-Min-Auth</title>
      </head>
      <body>
        <div>
          logged in as ${foundNut.user_id}
        </div>
      </body>
    </html>`;
  } else {
    body = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>SQRL-Min-Auth</title>
    </head>
    <body>
      <div>
        Failed to log in. Code is invalid
      </div>
      <a href="/dev/sqrl">Back to root</a>
    </body>
  </html>`;
  }
  const returnValue = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Mon, 01 Jan 1990 00:00:00 GMT',
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
