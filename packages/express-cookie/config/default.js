'use strict';

module.exports = {
  logger: { level: 'debug' },
  cookie: {
    secret: null,
    settings: {
      signed: true,
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 2 * 7 * 24 * 60 * 60, // 2 weeks in seconds
      path: '/',
      domain: null
    }
  },
  db: { connectionString: null },
  sqrl: {
    baseUrl: null,
    hmacSecret: null
  },
  express: { port: 3000, host: '0.0.0.0' },
  stopGrace: 5000
};
