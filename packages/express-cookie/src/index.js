'use strict';

const fs = require('fs');
const https = require('https');
const config = require('config');
const { createSQRLHandler } = require('sqrl-protocol');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const death = require('death')({ uncaughtException: true });
const express = require('express');
const expressPinoLogger = require('express-pino-logger');
const get = require('dlv');
const helmet = require('helmet');
const mustacheExpress = require('mustache-express');
const path = require('path');
const pino = require('pino');
const stoppable = require('stoppable');
const sqrlCrud = require('./lib/db/sqrl');
const nutCrud = require('./lib/db/nut');
const userCrud = require('./lib/db/user');

const sqrlHmac = config.get('sqrlHmac');
const stopGrace = config.get('stopGrace');
const loggerConfig = config.util.toObject(config.get('logger'));
const expressConfig = config.util.toObject(config.get('express'));

const domainName = 'self.test';

const logger = pino(loggerConfig);
const sqrlHandler = createSQRLHandler({
  baseUrl: `https://${domainName}:3000`,
  logger,
  sqrlCrud,
  nutCrud,
  userCrud,
  hmacSecret: sqrlHmac
});

// Exposed server
const app = express();

// Settings
app.set('trust proxy', 1);
app.set('json spaces', 2); // eslint-disable-line no-magic-numbers
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', path.join(__dirname, 'views'));

app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500);
  res.send('Error');
});

// Middleware
app.use(expressPinoLogger({ logger }));
app.use(helmet());
app.use(cookieParser('myCookieSecret'));
app.use(
  bodyParser.text({
    defaultCharset: 'utf-8',
    inflate: false,
    limit: 2048,
    type: '*/*'
  })
);

// Root
app.get('/', async (req, res) => {
  if (req.signedCookies.user) {
    res.redirect(302, '/loggedin');
  } else {
    const urls = await sqrlHandler.createUrls(req.connection.remoteAddress);
    logger.info({ urls }, 'created urls');
    res.render('index', { urls, urlsJson: JSON.stringify(urls) });
  }
});

// Protected route
app.get('/loggedin', async (req, res) => {
  if (!req.signedCookies.user) {
    res.redirect(302, '/');
  } else {
    res.render('loggedin', {
      userCookie: req.signedCookies.user,
      logoutUrl: '/logout'
    });
  }
});

app.post('/logout', async (req, res) => {
  res.cookie('user', '', {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
    domain: domainName
  });
  res.redirect(302, '/');
});
const cookieTimeout = 2 * 7 * 24 * 60 * 60; // 2 weeks in seconds

app.get('/authenticate', async (req, res) => {
  try {
    const codeParam = req.query.code;
    const requestIp = req.connection.remoteAddress;
    logger.info({ codeParam, requestIp }, 'authenticate');
    const foundNut = await sqrlHandler.useCode(codeParam, requestIp);
    logger.debug({ foundNut }, 'Found nut');
    if (foundNut && foundNut.user_id) {
      res.cookie('user', foundNut.user_id.toString(), {
        signed: true,
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: cookieTimeout,
        path: '/',
        domain: domainName
      });
      res.redirect(302, '/loggedin');
      return;
    }
  } catch (ex) {
    logger.error(ex);
  }
  res.sendStatus(404);
});

app.post('/sqrl', async (req, res) => {
  const inputNut = req.query.nut;
  const requestIp = req.connection.remoteAddress;
  const body = req.body;
  logger.info({ requestIp, body, inputNut }, '/sqrl');
  const sqrlResult = await sqrlHandler.handler(requestIp, inputNut, body);
  res
    .status(200)
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send(sqrlResult);
});

// Will have the Express server.
// eslint-disable-next-line prefer-const
let server;

const deathCleanup = death((signal, err) => {
  // Stop accepting connections (including health checks)
  if (server) {
    server.stop();
  }
  logger.info({ signal }, `Signal ${signal}`);
  logger.error(err);
  deathCleanup();
});

server = stoppable(
  https
    .createServer(
      {
        key: fs.readFileSync(__dirname + '/../self.key', 'utf8'),
        cert: fs.readFileSync(__dirname + '/../self.crt', 'utf8')
      },
      app
    )
    .listen(expressConfig, () => {
      const { address, port } = server.address();
      logger.info(`🚀 Server started at https://${address}:${port}`);
    }),
  stopGrace
);
