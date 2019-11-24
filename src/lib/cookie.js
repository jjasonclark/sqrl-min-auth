'use strict';

const get = require('dlv');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const {
  cookie: { secret: cookieSecret }
} = require('../../secrets.json');
const cookieTimeout = 2 * 7 * 24 * 60 * 60; // 2 weeks in seconds
const url = require('url');

const getUserCookie = cookies => {
  const signed = get(cookie.parse(cookies || ''), 'user');
  return signed ? cookieSignature.unsign(signed, cookieSecret) : false;
};

const createUserCookie = (userId, site) => {
  const apiBaseUrl = new url.URL(site);
  return cookie.serialize(
    'user',
    cookieSignature.sign(userId.toString(), cookieSecret),
    {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: apiBaseUrl.pathname,
      domain: apiBaseUrl.hostname,
      expires: new Date(Date.now() + cookieTimeout * 1000)
    }
  );
};

const clearUserCookie = site => {
  const apiBaseUrl = new url.URL(site);
  return cookie.serialize('user', '', {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    path: apiBaseUrl.pathname,
    domain: apiBaseUrl.hostname,
    expires: new Date('Sun, 06 Nov 1994 08:49:37 GMT')
  });
};

module.exports = { getUserCookie, createUserCookie, clearUserCookie };
