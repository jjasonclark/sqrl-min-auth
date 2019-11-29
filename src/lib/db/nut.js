'use strict';

const { db } = require('./db');

const mapFromDb = result => {
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

// Crud for nuts table
const nutCrud = {
  async create(it) {
    // TODO: verify write
    const result = await db.oneOrNone(
      'INSERT INTO nuts (nut,initial,ip,user_id,hmac) VALUES (${nut},${initial},${ip},${user_id},${hmac}) RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      it
    );
    return mapFromDb(result);
  },

  async retrieve(nut) {
    const result = await db.oneOrNone(
      'SELECT id,nut,initial,ip,hmac,created,used,identified,issued,user_id FROM nuts WHERE nut = ${nut}',
      { nut }
    );
    return mapFromDb(result);
  },

  async useNut(nut) {
    const result = await db.oneOrNone(
      'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = ${nut} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      { nut }
    );
    return mapFromDb(result);
  },

  // Called to indicate the code has been issued to a user
  async issueNut(nut, ip) {
    const result = await db.oneOrNone(
      'UPDATE nuts SET issued=NOW() WHERE issued IS NULL AND identified IS NOT NULL AND nut = ${nut} AND ip = ${ip} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      { nut, ip }
    );
    return mapFromDb(result);
  },

  async update(it) {
    const result = await db.oneOrNone(
      'UPDATE nuts SET identified=${identified},user_id=${user_id} WHERE id = ${id} RETURNING id,nut,initial,ip,hmac,created,used,identified,issued,user_id',
      it
    );
    return mapFromDb(result);
  }
};

module.exports = nutCrud;
