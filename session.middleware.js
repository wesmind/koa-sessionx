/**
 * code based on koa-session@6.2.0 because the original codebase full of bugs and dirty codes!
 * https://github.com/koajs/session
 */

import { randomBytes } from 'crypto';

import _debug from 'debug';
const debug = _debug('koa-session');

import SessionContext from './lib/context.class.js';
import util from './lib/util.js';
import assert from 'assert';

const SESSION_CONTEXT = Symbol('context#sessionContext');
const _SESSION_CONTEXT = Symbol('context#_sessionContext');

export default sessionBuilder;
/**
 * Initialize session middleware with `opts`:
 *
 * - `key` session cookie name ["koa.sess"]
 * - all other options are passed as cookie options
 *
 * @param {Application} app, koa application instance
 * @param {Object} [opts]
 * @api public
 */

function sessionBuilder(app, opts) {
  // app required
  if (!app || typeof app.use !== 'function') {
    throw new TypeError('app instance required: `session(opts, app)`');
  }

  opts = formatOpts(opts);

  extendContext(app.context, opts);

  return async function session(ctx, next) {
    const sessCtx = ctx[SESSION_CONTEXT];

    // Date.now() returns the milliseconds elapsed since January 1, 1970 00:00:00 UTC.
    if(!ctx.utcDateNow) ctx.utcDateNow = Date.now(); 

     //// don't use lazy mode, bcs initFromExternal is an async function
    if (sessCtx.store) await sessCtx.initFromExternal();

    try {
      await next();
    } catch (err) {
      throw err;
    } finally {
      if (opts.autoCommit) {
        await sessCtx.commit();
      }
    }
  };
};

/**
 * format and check session options
 * @param  {Object} opts session options
 * @return {Object} new session options
 *
 * @api private
 */

function formatOpts(opts) {
  opts = opts || {};
  // key
  opts.key = opts.key || 'koa.sess';

  // defaults
  opts.overwrite = opts.overwrite ?? true;
  opts.httpOnly = opts.httpOnly ?? true;
  opts.signed = opts.signed ?? true;
  opts.autoCommit = opts.autoCommit ?? true;
  opts.sessStoreAge = opts.sessStoreAge ?? 3600 * 1000 ; //1hour

  // delete null sameSite config
  if (opts.sameSite == null) delete opts.sameSite;

  debug('session options %j', opts);

  // setup encoding/decoding
  if (typeof opts.encode !== 'function') {
    opts.encode = util.encode;
  }

  if (typeof opts.decode !== 'function') {
    opts.decode = util.decode;
  }

  const store = opts.store;
  if (store) {
    assert(typeof store.get == 'function', 'store.get must be function');
    assert(typeof store.set == 'function', 'store.set must be function');
    assert(typeof store.destroy == 'function', 'store.destroy must be function');
  }

  const customSessId = opts.customSessId;
  if (customSessId) {
    assert(typeof customSessId.get == 'function', 'customSessId.get must be function');
    assert(typeof customSessId.set == 'function', 'customSessId.set must be function');
  }

  const ContextStore = opts.ContextStore;
  if (ContextStore) {
    assert(typeof ContextStore == 'class', 'ContextStore must be a class');
    assert(typeof ContextStore.get == 'function', 'ContextStore.prototype.get must be function');
    assert(typeof ContextStore.set == 'function', 'ContextStore.prototype.set must be function');
    assert(typeof ContextStore.destroy == 'function', 'ContextStore.prototype.destroy must be function');
  }

  if (!opts.genSessId) {
    if (opts.prefix) opts.genSessId = () => `${opts.prefix}${genSessId()}`;
    else opts.genSessId = genSessId;
  }

  return opts;
}

/**
 * extend context prototype, add session properties
 *
 * @param  {Object} context koa's context prototype
 * @param  {Object} opts session options
 *
 * @api private
 */

function extendContext(context, opts) {
  if (context.hasOwnProperty(SESSION_CONTEXT)) {
    return;
  }

  Object.defineProperties(context, {
    [SESSION_CONTEXT]: {
      get() { //getter:  this[SESSION_CONTEXT]; this is an instance of koa.context, so this[_SESSION_CONTEXT] is new for each request
        if (this[_SESSION_CONTEXT]) return this[_SESSION_CONTEXT];
        this[_SESSION_CONTEXT] = new SessionContext(this, opts);
        return this[_SESSION_CONTEXT];
      },
    },

    session: {
      get() { //getter: ctx.session
        return this[SESSION_CONTEXT].get();
      },

      set(val) { //setter: ctx.session=xxx
        this[SESSION_CONTEXT].set(val);
      },

      configurable: true,
    },

    sessionOptions: {
      get() {
        return this[SESSION_CONTEXT].opts;
      },
    },
  });
}

/**
 * 
 * @returns 
 */
function genSessId() {
  return randomBytes(16).toString('hex'); //>>> hex is more fast
}