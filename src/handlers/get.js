'use strict';

const logger = require('pino')({ level: 'debug' });

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');
  const fetchUrl = `https://${
    event.requestContext.domainName
  }${event.requestContext.path
    .toString()
    .substr(
      0,
      event.requestContext.path.length -
        event.requestContext.resourcePath.length
    )}/urls`;
  const body = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>SQRL-Min-Auth</title>
    </head>
    <body>
      <div>
        <a id="sqrlLogin">login</a>
      </div>
      <div id="sqrlqr"></div>
      <script crossorigin src="https://unpkg.com/qrjs2@0.1.7/js/qrjs2.js"></script>
      <script crossorigin src="https://unpkg.com/unfetch/polyfill"></script>
      <script>
        function createCpsTestUrl() {
          return 'http://localhost:25519/' + Date.now() + '.gif';
        }

        function setCpsLoginLink(cpsUrl) {
          var img = new Image();
          img.src = createCpsTestUrl();
          img.onload = function() {
            console.log('Local SQRL client found');
            document.getElementById('sqrlLogin').href = cpsUrl;
          };

          img.onerror = function() {
            setTimeout(function() {
              img.src = createCpsTestUrl();
            }, 500);
          };
        }

        function getUrls() {
          fetch('${fetchUrl}')
            .then(function(r) {
              return r.json();
            })
            .then(function(urls) {
              var sqrlQrSvg = QRCode.generateSVG(urls.login);
              document.getElementById('sqrlqr').appendChild(sqrlQrSvg);
              document.getElementById('sqrlLogin').href = urls.login;
              setCpsLoginLink(urls.cps);
            });
        }

        setTimeout(getUrls, 100);
      </script>
    </body>
  </html>`;
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
