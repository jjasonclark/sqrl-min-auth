'use strict';

const config = require('config');
const pgp = require('pg-promise')();

const db = pgp(config.get('db.connectionString'));

module.exports = { db };
