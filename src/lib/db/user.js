'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

// Crud for sqrl table
const userCrud = {
  async create() {
    // Create an account
    logger.info('Creating new user account');
    const user = await db.one('INSERT INTO users default VALUES RETURNING id');
    if (!user) {
      // something went wrong
      return null;
    }
    logger.info({ user }, 'Created new user account');
    return user;
  },

  async delete(id) {
    // Delete user
    await db.none('DELETE FROM users WHERE id = $1', [id]);
    logger.info({ id }, 'Deleted user');
  }
};

module.exports = userCrud;
