'use strict';

const bodyParser = require('body-parser');
const config = require('config');
const cookieParser = require('cookie-parser');
const death = require('death')({ uncaughtException: true });
const express = require('express');
const expressPinoLogger = require('express-pino-logger');
const helmet = require('helmet');
const https = require('https');
const mustacheExpress = require('mustache-express');
const path = require('path');
const pino = require('pino');
const stoppable = require('stoppable');
const { createSQRLHandler } = require('sqrl-protocol');
const PgSqrlStore = require('pg-sqrl-store');

const connectionString = config.get('db.connectionString');
const sqrlConfig = config.get('sqrl');
const stopGrace = config.get('stopGrace');
const cookieSecret = config.get('cookie.secret');
const cookieConfig = config.util.toObject(config.get('cookie.settings'));
const loggerConfig = config.util.toObject(config.get('logger'));
const expressConfig = config.util.toObject(config.get('express'));
const httpsConfig = config.util.toObject(config.get('https'));

const logger = pino(loggerConfig);
const sqrlHandler = createSQRLHandler({
  ...sqrlConfig,
  logger,
  store: new PgSqrlStore(connectionString, { logger })
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
app.use(cookieParser(cookieSecret));
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
    ...cookieConfig,
    maxAge: 0
  });
  res.redirect(302, '/');
});

app.get('/authenticate', async (req, res) => {
  try {
    const codeParam = req.query.code;
    const requestIp = req.connection.remoteAddress;
    logger.info({ codeParam, requestIp }, 'authenticate');
    const user = await sqrlHandler.useCode(codeParam, requestIp);
    logger.debug({ user }, 'Found user');
    if (user && user.id) {
      res.cookie('user', user.id.toString(), cookieConfig);
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
  https.createServer(httpsConfig, app).listen(expressConfig, () => {
    const { address, port } = server.address();
    logger.info(`🚀 Server started at https://${address}:${port}`);
  }),
  stopGrace
);
