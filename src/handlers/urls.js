'use strict';

const logger = require('pino')({ level: 'debug' });
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
      login: `sqrl://${domain}${path}?${querystring.encode(urlReturn)}`
    });
    const results = {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Mon, 01 Jan 1990 00:00:00 GMT',
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
