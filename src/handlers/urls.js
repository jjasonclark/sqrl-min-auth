'use strict';

const logger = require('pino')({ level: 'info' });
const querystring = require('querystring');
const url = require('url');
const base64url = require('universal-base64url');
const get = require('dlv');
const apiBaseUrl = new url.URL(process.env.URL_BASE);
const { createInitialNut } = require('../lib/db/nut');

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');
  try {
    const requestIp = get(event, 'requestContext.identity.sourceIp');
    const domain = apiBaseUrl.hostname;
    const x = apiBaseUrl.pathname.length;
    const path = `${apiBaseUrl.pathname}/sqrl`;
    const urlReturn = { nut: await createInitialNut(requestIp) };
    if (x > 0) {
      urlReturn.x = x;
    }

    const body = JSON.stringify({
      cps: `http://localhost:25519/${base64url.encode(
        `sqrl://${domain}${path}?${querystring.encode({
          ...urlReturn,
          can: base64url.encode(path)
        })}`
      )}`,
      login: `sqrl://${domain}${path}?${querystring.encode(urlReturn)}`,
      poll: `${apiBaseUrl}/authenticate?code=${urlReturn.nut}`
    });
    const results = {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
        Pragma: 'no-cache',
        Vary: 'Origin',
        'Cache-control': 'no-cache',
        'Content-Type': 'application/json;charset=utf-8',
        'Content-Length': body.length.toString()
      },
      body
    };
    logger.debug({ results }, 'returning');
    return results;
  } catch (error) {
    logger.error(error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    };
  }
};

module.exports = { handler };
