'use strict';

const pgp = require('pg-promise')();
const get = require('dlv');

const reorder = (objects, names, prop = 'idk') => {
  const output = new Array(names.length);
  let i = 0;
  const lookup = names.reduce((memo, name) => ({ ...memo, [name]: i++ }), {});
  for (const obj of objects) {
    const spot = get(lookup, get(obj, prop), -1);
    if (spot >= 0) {
      output[spot] = obj;
    }
  }
  return output;
};

const cleanString = value => {
  if (!value) {
    return null;
  }
  const formatted = value.toString().trim();
  if (!formatted || formatted === '') {
    return null;
  }
  return formatted;
};

const formatSqrl = result => ({
  ...result,
  idk: cleanString(result.idk),
  suk: cleanString(result.suk),
  vuk: cleanString(result.vuk)
});

const formatNut = result => {
  if (!result) {
    return null;
  }
  return {
    nut: result.nut.toString().trim(),
    ip: result.ip.toString().trim(),
    hmac: result.hmac ? result.hmac.toString().trim() : null,
    created: Date.parse(result.created),
    used: result.used ? Date.parse(result.used) : null,
    identified: result.identified,
    issued: result.issued ? Date.parse(result.issued) : null,
    id: result.id,
    initial: result.initial,
    user_id: result.user_id
  };
};

class PgSqrlStore {
  constructor(connectionString) {
    this.db = pgp(connectionString);
  }

  async createNut(it) {
    // TODO: verify write
    const result = await this.db.oneOrNone(
      'INSERT INTO nuts (nut,initial,ip,user_id,hmac) VALUES (${nut},${initial},${ip},${user_id},${hmac}) RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      it
    );
    return formatNut(result);
  }

  async useNut(nut) {
    const result = await this.db.oneOrNone(
      'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = ${nut} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      { nut }
    );
    return formatNut(result);
  }

  // Called to indicate the code has been issued to a user
  async issueNut(nut, ip) {
    const result = await this.db.oneOrNone(
      'UPDATE nuts SET issued=NOW() WHERE issued IS NULL AND identified IS NOT NULL AND nut = ${nut} AND ip = ${ip} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      { nut, ip }
    );
    return formatNut(result);
  }

  async identifyNut(it) {
    const result = await this.db.oneOrNone(
      'UPDATE nuts SET identified=${identified},user_id=${user_id} WHERE id = ${id} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      it
    );
    return formatNut(result);
  }

  async createSqrl(it) {
    return await this.db.oneOrNone(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,created) VALUES (${idk},${user_id},${suk},${vuk},${created}) RETURNING idk,user_id,suk,vuk,created,disabled,superseded',
      it
    );
  }

  async retrieveSqrl(idks) {
    const results = await this.db.manyOrNone(
      'SELECT idk,user_id,suk,vuk,created,disabled,superseded FROM sqrl WHERE idk IN ($1:list)',
      [idks]
    );
    if (!results) {
      return null;
    }

    return reorder(results.map(formatSqrl), idks);
  }

  async updateSqrl(it) {
    return await this.db.none(
      'UPDATE sqrl set disabled=${disabled},superseded=${superseded} WHERE idk = ${idk}',
      it
    );
  }

  async deleteSqrl(userId) {
    return await this.db.none('DELETE FROM sqrl WHERE user_id = $1', [userId]);
  }

  async createUser() {
    // Create an account
    const user = await this.db.one(
      'INSERT INTO users default VALUES RETURNING id'
    );
    if (!user) {
      // something went wrong
      return null;
    }
    return user;
  }

  async deleteUser(id) {
    // Delete user
    await this.db.none('DELETE FROM users WHERE id = ${id}', { id });
  }
}

module.exports = PgSqrlStore;
