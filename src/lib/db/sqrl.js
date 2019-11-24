'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

// Crud for sqrl table
const sqrlCrud = {
  async create(it) {
    const sqrlData = await db.oneOrNone(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,hardlock,sqrlonly) VALUES ($1,$2,$3,$4,$5,$6) RETURNING idk',
      [it.idk, it.user_id, it.suk, it.vuk, it.hardlock, it.sqrlonly]
    );
    if (sqrlData) {
      // Account setup successfully
      logger.info({ sqrlData }, 'Account created');
      return sqrlData;
    }
    // something went wrong
    logger.info({ it }, 'Could not create sqrl row');
    return null;
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

  async delete(userId) {
    return await db.none('DELETE FROM sqrl WHERE user_id = $1', [userId]);
  }
};

module.exports = sqrlCrud;
