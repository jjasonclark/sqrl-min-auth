'use strict';

const path = require('path');
const logger = require('pino')({ level: 'info' });
const fs = require('fs');
const util = require('util');
const pgp = require('pg-promise')();

const readFile = util.promisify(fs.readFile);
const sqlPath = path.resolve(__dirname, '..', '..', 'sql/create.sql');
const connectionString = process.env.POSTGRES_CONNECTION_STRING;

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');
  try {
    logger.info({ sqlPath }, 'reading file');
    const commands = (await readFile(sqlPath)).toString();
    logger.info({ commandLength: commands.length }, 'Read migration file');
    const db = pgp(connectionString);
    const result = await db.none(commands);
    logger.info({ result }, 'Apply success');
    await pgp.end();
    return { success: true };
  } catch (error) {
    logger.error(error);
  }
  return { success: false };
};

module.exports = { handler };
