'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

// Crud for sqrl table
const sqrlCrud = {
  async create(it) {
    // failed to find the user. Need to create an account
    logger.info('Creating new user account');
    const user = await db.one('INSERT INTO users default VALUES RETURNING id');
    if (!user) {
      // something went wrong
      return null;
    }
    const sqrlIdk = await db.one(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,hardlock,sqrlonly) VALUES ($1,$2,$3,$4,$5,$6) RETURNING idk',
      [it.idk, user.id, it.suk, it.vuk, it.hardlock, it.sqrlonly]
    );
    if (sqrlIdk) {
      // Account setup successfully
      logger.info('Account created');
      return user.id;
    } else {
      // something went wrong
      logger.info(
        { user },
        'Could not create sqrl row. Attempting to delete user'
      );
      // remove the created user
      await db.none('DELETE FROM users WHERE id = $1', [user.id]);
      logger.info({ user }, 'User deleted');
      return null;
    }
  },

  async retrieve(idk) {
    const result = await db.oneOrNone(
      'SELECT user_id, suk, vuk, enabled, hardlock, sqrlonly, superseded FROM sqrl WHERE idk = $1',
      [idk]
    );
    if (!result) {
      return null;
    }
    return {
      ...result,
      idk,
      suk: result.suk ? result.suk.toString().trim() : null,
      vuk: result.vuk ? result.vuk.toString().trim() : null
    };
  },

  async update(idk, { enabled, hardlock, sqrlonly, superseded = null }) {
    return await db.none(
      'UPDATE sqrl set enabled=$1,hardlock=$2,sqrlonly=$3,superseded=$4 WHERE idk = $5',
      [enabled, hardlock, sqrlonly, superseded, idk]
    );
  },

  async delete(idk) {
    const deletedSqrl = await db.oneOrNone(
      'DELETE FROM sqrl WHERE idk = $1 returning user_id',
      [idk]
    );
    logger.info(
      { idk: client.idk, userId: deletedSqrl.user_id },
      'Deleting user'
    );
    // Delete user
    await db.none('DELETE FROM users WHERE id = $1', [deletedSqrl.user_id]);
    logger.info({ userId: deletedSqrl.user_id }, 'Deleted user');
  }
};

module.exports = sqrlCrud;
