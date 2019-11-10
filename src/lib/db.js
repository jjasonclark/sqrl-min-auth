'use strict';

const pgp = require('pg-promise')();

const db = pgp(process.env.POSTGRES_CONNECTION_STRING);

module.exports = { db };
