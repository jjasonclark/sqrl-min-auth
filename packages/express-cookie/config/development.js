'use strict';

module.exports = {
  logger: { level: 'debug' },
  cookie: {
    secret: 'myCookieSecret',
    settings: {
      signed: true,
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 2 * 7 * 24 * 60 * 60, // 2 weeks in seconds
      path: '/',
      domain: 'self.test'
    }
  },
  db: { connectionString: 'postgres://sqrl:sqrl@localhost:5432/sqrl' },
  sqrl: {
    baseUrl: 'https://self.test:3000',
    blowfishSecrets: {
      key: 'abcdefghijklmnopqrst',
      iv: '12345678'
    },
    hmacSecret: 'mysuperSecret!'
  }
};
