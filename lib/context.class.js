import _debug from 'debug';
const debug = _debug('koa-session:context');

import Session from './session.class.js';
import util from './util.js';

const COOKIE_EXP_DATE = new Date(util.CookieDateEpoch);
const ONE_DAY = 24 * 60 * 60 * 1000;

export default class SessionContext {

  /**
   * context session constructor
   * @param {Koa.context} ctx
   * @api public
   */

  constructor(ctx, opts) {
    this.ctx = ctx;
    this.app = ctx.app;
    this.opts = Object.assign({}, opts);
    this.store = this.opts.ContextStore ? new this.opts.ContextStore(ctx) : this.opts.store;
    this.needRenew = false;
  }

  /**
   * internal logic of `ctx.session`
   * @return {Session} session object
   *
   * @api public
   */

  get() {
    const session = this.session;
    // already retrieved
    if (session) return session;
    // unset
    if (session === false) return null;

    // create an empty session or init from cookie
    this.store ? this.createSession() : this.initFromCookie();

    return this.session;
  }

  /**
   * internal logic of `ctx.session=`
   * @param {Object} val session object
   *
   * @api public
   */

  set(val) {
    //destory session by `ctx.session=null`
    if (val === null) {
      this.session = false;
      return;
    }

    if (typeof val === 'object') {
      // use the original `sessionId` if exists to avoid waste storage
      this.createSession(val, this.sessionId);
      return;
    }

    throw new Error('this.session can only be set as null or an object.');
  }

  /**
   * init session from external store
   * will be called in the front of session middleware bcs it is an `async` function
   *
   * @api public
   */

  async initFromExternal() {
    debug('init from external');

    const ctx = this.ctx; //// Koa.context
    const opts = this.opts;

    let sessionId;

    if (opts.customSessId) {
      sessionId = opts.customSessId.get(ctx); //>>> used for native Apps with no cookie support
      debug('get session ID from custom %s', sessionId);
    } else {
      sessionId = ctx.cookies.get(opts.key, opts); //>>> used for Browsers with cookie support
      debug('get session ID from cookie %s', sessionId);
    }


    if (!sessionId) {
      // create a new `sessionId`
      this.createSession();
      return;
    }

    const sessJson = await this.store.get(sessionId, opts.maxAge, { ctx });
    if (!this.valid(sessJson, sessionId)) {

      await this.store.destroy(sessionId, { ctx });

      // create a new `sessionId`
      this.createSession();
      return;
    }

    // create with original `sessionId`
    this.createSession(sessJson, sessionId);
    // this.prevHash = util.hash(this.session.toJSON()); //---
    this.prevHash = JSON.stringify(this.session.toJSON()); //---
  }

  /**
   * init session from cookie
   * @api private
   */

  initFromCookie() {
    debug('init from cookie');

    const ctx = this.ctx; ////Koa.context
    const opts = this.opts;

    const cookie = ctx.cookies.get(opts.key, opts);
    if (!cookie) {
      this.createSession();
      return;
    }

    let sessJson;
    debug('parse %s', cookie);

    try {
      sessJson = opts.decode(cookie);
    } catch (err) {
      // backwards compatibility:
      // create a new session if parsing fails.
      // new Buffer(string, 'base64') does not seem to crash
      // when `string` is not base64-encoded.
      // but `JSON.parse(string)` will crash.
      debug('decode %j error: %s', cookie, err);

      if (!(err instanceof SyntaxError)) {
        // clean this cookie to ensure next request won't throw again
        ctx.cookies.set(opts.key, '', opts);

        // ctx.onerror will unset all headers, and set those specified in err
        err.headers = {
          'set-cookie': ctx.response.get('set-cookie'),
        };

        throw err;
      }

      this.createSession();

      return;
    }

    debug('parsed %j', sessJson);

    if (!this.valid(sessJson)) {
      this.createSession();
      return;
    }

    // support access `ctx.session` before session middleware
    this.createSession(sessJson);

    // this.prevHash = util.hash(this.session.toJSON()); //---
    this.prevHash = JSON.stringify(this.session.toJSON()); //---
  }

  /**
   * verify session(expired or )
   * @param  {Object} sessJson session object
   * @param  {Object} sessionId sessionId(optional)
   * @return {Boolean} valid
   * @api private
   */

  valid(sessJson, sessionId) {
    const ctx = this.ctx;

    if (!sessJson) {
      // this.emit('missed', { sessionId, sessValue: sessJson, ctx }); //---
      return false;
    }

    if (sessJson._expire && sessJson._expire < ctx.utcDateNow) { //todo: del the store data
      debug('^^^^^^ expired session');
      // this.emit('expired', { sessionId, sessValue: sessJson, ctx });  //---
      return false;
    }

    const valid = this.opts.valid;
    if (valid && typeof valid === 'function' && !valid(ctx, sessJson)) { //todo: del the store data
      // valid session value fail, ignore this session
      debug('~~~~~~~ invalid session');
      this.emit('invalid', { sessionId, sessValue: sessJson, ctx }); //---
      return false;
    }

    return true;
  }

  /**
   * @param {String} event event name
   * @param {Object} data event data
   * @api private
   */
  emit(event, data) {
    setImmediate(() => {
      this.app.emit(`session:${event}`, data);
    });
  }

  /**
   * create a new session and attach to ctx.sess
   *
   * @param {Object} [sessData] session data
   * @param {String} [sessionId] session session ID
   * @api private
   */

  createSession(sessData, sessionId) {
    debug('create session with val: %j sessionId: %s', sessData, sessionId);

    //// note only need sessionId when save the session data on server side!
    if (this.store) this.sessionId = sessionId || this.opts.genSessId && this.opts.genSessId(this.ctx);

    this.session = new Session(this, sessData, this.sessionId);
  }

  /**
   * Commit the session changes or removal.
   *
   * @api public
   */

  async commit() {
    const session = this.session;
    const opts = this.opts;
    const ctx = this.ctx; ////koa.context

    // not external store and not accessed 
    if (undefined === session) return;

    // removed; done by `ctx.session=null`
    if (session === false) {
      await this.remove();
      return;
    }

    const sessJson = session.toJSON();

    //session data must renew
    if (opts.maxAge == 'session') {
      this.needRenew = true;
    } else if (opts.renew) { //renew previous session expiration
      const expire = session._expire;

      if (expire) {
        const maxAge = session._maxAge; //>>> wrong if opts.maxAge=='session'
        // renew when session will expired in maxAge / 2
        if (maxAge && (expire - this.ctx.utcDateNow < maxAge * 0.6)) {
          this.needRenew = true;
        }
      }
    }

    const reason = this._shouldSaveSession(sessJson);

    debug('should save session: %s', reason);

    if (!reason) return;

    // if (typeof opts.beforeSave === 'function') {
    //   debug('before save');
    //   opts.beforeSave(ctx, session);
    // }

    const changed = reason !== 'n';

    await this.save(changed, sessJson);
  }

  _shouldSaveSession(sessJson) {
    const prevHash = this.prevHash; //---
    const session = this.session;

    // force save session when `session._requireSave` set
    if (session._requireSave) return 'f';

    // do nothing if new and not populated
    // const sessJson = session.toJSON();
    if (!prevHash && !Object.keys(sessJson).length) return ''; ////todo: don't save empty session

    // save if session changed
    // const changed = prevHash !== util.hash(sessJson);
    const changed = prevHash !== JSON.stringify(sessJson);
    if (changed) return 'c';
    else return 'n';
  }

  /**
   * remove session
   * @api private
   */

  async remove() {
    // Override the default options so that we can properly expire the session cookies
    const opts = Object.assign({}, this.opts, {
      expires: COOKIE_EXP_DATE,
      maxAge: false,
    });

    const ctx = this.ctx;
    const key = opts.key;
    const sessionId = this.sessionId;

    if (sessionId) await this.store.destroy(sessionId, { ctx });

    ctx.cookies.set(key, '', opts);
  }

  /**
   * save session
   * @param {true|false} changed  wheather the session data changed or not compared with the previous one
   * @api private
   */

  async save(changed, sessJson) {
    const ctx = this.ctx;
    const opts = this.opts;
    const key = opts.key;
    const sessionId = this.sessionId;

    const newSess = this.session._expire === undefined;
    // let sessJson = this.session.toJSON(); //---

    // set expire for check
    let maxAge = opts.maxAge ? opts.maxAge : ONE_DAY;


    if (maxAge === 'session') {
      // do not set _expire in json if maxAge is set to 'session'
      // also delete maxAge from options
      opts.maxAge = undefined;
      sessJson._expire = opts.sessStoreAge + ctx.utcDateNow;
    } else {
      // set expire for check; 
      if (this.needRenew || newSess) { //!this.session._expire means new session
        sessJson._expire = maxAge + ctx.utcDateNow;
      } else {
        sessJson._expire = this.session._expire;
      }
    }

    sessJson._maxAge = maxAge;

    // save to external store(Redis)
    if (sessionId) {
      debug('save %j to session ID %s', sessJson, sessionId);

      if (maxAge == 'session') {

        maxAge = opts.sessStoreAge;
      }

      // ensure store expired after cookie
      maxAge += 5000;

      await this.store.set(sessionId, sessJson, maxAge, {
        changed,
        newSess,
        renew: this.needRenew,
        ctx,
      });

      if (opts.customSessId) {
        opts.customSessId.set(ctx, sessionId);
      } else {
        ctx.cookies.set(key, sessionId, opts);
      }

      return;
    }

    // save to cookie
    debug('save %j to cookie', sessJson);

    sessJson = opts.encode(sessJson);

    debug('save %s', sessJson);

    this.ctx.cookies.set(key, sessJson, opts);
  }
}