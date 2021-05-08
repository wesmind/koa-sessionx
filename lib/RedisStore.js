/*!
 * Used for koa-session.
 *
 * @author Wes Lee<wesmind@gmail.com>.
 * @github https://github.com/wesmind.
 */

import util from 'util';
import RedisClass from 'ioredis'; //>>> 

import redisCfg from '../config/redis.config.js';
import { logRedisError } from './coreFuncs.js';

const host = redisCfg.dbHosts['master']; //for session, only use Redis in master
const options = Object.assign({}, redisCfg.comOpts, host, { db: redisCfg.sessionDb });

const redis = new RedisClass(options);

redis.on("error", function (error) {
  logRedisError('^^^^^^^^ Session Redis error: ' + util.inspect(error));
  throw error;
});

const ONE_DAY = 24 * 60 * 60 * 1000;

const redisStore = {
  /**
   * 
   * @todo support rolling/renew/expire/...
   * 
   * @param {string}} key prefixed session id
   * @param {object} sess session data object
   * @param {number|string} maxAge number in milliseconds | string = 'session'
   * @param {object} options  { changed, ctx: koa.ctx, newSess, renew:true/false}
   *            changed={true|false} //session data changed or not from last session
   * @returns 
   */
  async set(key, sess, maxAge = 0, options = null) {

    if (options.newSess) {
      return redis.set(key, JSON.stringify(sess), 'PX', maxAge);
    }

    if (options.renew) { //for session and use renew config
      return redis.set(key, JSON.stringify(sess), 'PX', maxAge); //maxAge in `ms`; EX in secs; PX in millsecs
    } else {
      if (options.changed) {
        const leftAge = sess._expire - options.ctx.utcDateNow; 

        if (leftAge > 0) return redis.set(key, JSON.stringify(sess), 'PX', leftAge); //maxAge in `ms`; EX in secs; PX in millsecs
      }
    }

    return true;
  },

  /**
   * @todo support rolling/renew/expire/...
   * 
   * @param {string}} key prefixed session id
   * @param {number} maxAge in milliseconds
   * @param {object} options { ctx: koa.context, rolling: opts.rolling } 
   * @returns 
   */
  async get(key, maxAge = 0, options = null) {
    return redis.get(key).then(data => JSON.parse(data));
  },

  /**
   * 
   * @param {string}} key prefixed session id
   * @param {object} options { ctx: koa.context } 
   * @returns 
   */
  async destroy(key, options = null) {
    return redis.del(key);
  },
}

export default redisStore;