'use strict';

const logger = require('pino')({ level: 'info' });
const pgp = require('pg-promise')();

const connectionString = process.env.POSTGRES_CONNECTION_STRING;

const handler = async (event, context) => {
  try {
    const db = pgp(connectionString);
    logger.info({ event, context }, 'Starting handler');
    await db.none(
      "DELETE FROM nuts WHERE initial IS NOT NULL AND created <= NOW() - INTERVAL '1 DAY'"
    );
    await db.none(
      "DELETE FROM nuts WHERE initial IS NULL AND created <= NOW() - INTERVAL '1 DAY' AND id NOT IN (SELECT initial AS id FROM nuts WHERE created >= NOW() - INTERVAL '1 DAY')"
    );
    await pgp.end();
    return { success: true };
  } catch (error) {
    logger.error(error);
    return { success: false };
  }
};

module.exports = { handler };
