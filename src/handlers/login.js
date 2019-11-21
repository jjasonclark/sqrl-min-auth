'use strict';

const url = require('url');
const querystring = require('querystring');
const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const cookie = require('cookie');
const base64url = require('universal-base64url');
const nutCrud = require('../lib/db/nut');
const { createNut } = require('../lib/nut');

const successUrl = `${process.env.URL_BASE}/loggedin`;

const createUrls = async (baseUrl, requestIp) => {
  logger.debug({ baseUrl, requestIp }, 'Create urls');
  const apiBaseUrl = new url.URL(baseUrl);
  const domain = apiBaseUrl.hostname;
  const x = apiBaseUrl.pathname.length;
  const path = `${apiBaseUrl.pathname}/sqrl`;
  const nut = await createNut();
  logger.debug({ nut }, 'Created nut');
  const savedNut = await nutCrud.create({ ip: requestIp, nut, code: nut });
  logger.debug({ nut, savedNut }, 'Saved nut');
  const urlReturn = { nut };
  if (x > 0) {
    urlReturn.x = x;
  }
  return {
    cps: `http://localhost:25519/${base64url.encode(
      `sqrl://${domain}${path}?${querystring.encode({
        ...urlReturn,
        can: base64url.encode(path)
      })}`
    )}`,
    login: `sqrl://${domain}${path}?${querystring.encode(urlReturn)}`,
    poll: `${process.env.URL_BASE}/authenticate?code=${urlReturn.nut}`,
    success: successUrl
  };
};

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const cookies = get(event, 'headers.Cookie', '');
  const userCookie = get(cookie.parse(cookies), 'user', false);
  logger.debug({ cookies, userCookie }, 'Cookies');

  if (userCookie) {
    const errorReturn = {
      statusCode: 302,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
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
  const urls = await createUrls(
    process.env.URL_BASE,
    get(event, 'requestContext.identity.sourceIp')
  );
  logger.debug({ urls }, 'Created urls');
  const body = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>SQRL-Min-Auth</title>
      <style>
        a {
          display: block;
          margin: 10px;
          background-color: lightsalmon;
          border: 2px solid black;
          width: 200px;
        }
      </style>
    </head>
    <body>
      <div>
        <a href="${urls.login}">login with SQRL://</a>
        <a id="sqrlLogin" href="${
          urls.login
        }" onclick="startCpsPolling()">login</a>
        <a onclick="startCpsPolling()">CPS login</a>
      </div>
      <div id="sqrlqr" style="width:350px"></div>
      <script crossorigin src="https://unpkg.com/qrjs2@0.1.7/js/qrjs2.js"></script>
      <script crossorigin src="https://unpkg.com/unfetch/polyfill"></script>
      <script>
        var urls = ${JSON.stringify(urls)};
        var pollCount = 20;
        // Poll for login via a different device
        function pollLogin() {
          console.log('Starting polling for logged in %s', urls.poll);
          if(--pollCount < 0) {
            console.log('Stopping polling');
            return;
          }
          return fetch(urls.poll)
            .then(function(res) {
              if(res.status !== 404) {
                console.log('Navigating to %s', urls.success);
                window.location.assign(urls.success);
              } else {
                setTimeout(pollLogin, 5000);
              }
            })
            .catch(function(error) {
              console.error(error);
              setTimeout(pollLogin, 5000);
            });
        }

        function createCpsTestUrl() {
          var result = 'http://localhost:25519/' + Date.now() + '.gif';
          console.log('Creating image check url of %s', result);
          return result;
        }

        function startCpsPolling() {
          console.log('CPS polling starting for %s', urls.cps);
          var img = new Image();
          img.onload = function() {
            console.log('CPS found. Navigating to %s', urls.cps);
            pollCount = -1;
            window.location.assign(urls.cps);
          };
          img.onerror = function() {
            console.log('Error response from image check');
            setTimeout(function() {
              img.src = createCpsTestUrl();
            }, 250);
          };
          img.src = createCpsTestUrl();
          return true;
        }

        function startup() {
          var sqrlUrl = document.getElementById('sqrlLogin').href;
          var sqrlQrSvg = QRCode.generateSVG(sqrlUrl);
          document.getElementById('sqrlqr').appendChild(sqrlQrSvg);
          pollLogin();
        }

        setTimeout(startup, 100);
      </script>
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
