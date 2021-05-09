/**
 * Session model.
 */

const inspect = Symbol.for('nodejs.util.inspect.custom');

export default class Session {
  /**
   * Session constructor
   * @param {SessionContext} sessionContext
   * @param {Object} sessData
   * @param {String} sessionId
   * @api private
   */

  constructor(sessionContext, sessData, sessionId) {
    this._sessCtx = sessionContext;
    this._ctx = sessionContext.ctx; //koa.context
    this._sessionId = sessionId;
    
    if (!sessData) {
      this.isNew = true;
    } else {
      for (const k in sessData) {
        // restore maxAge from store; maxAge=number|'session'
        if (k == '_maxAge') this._ctx.sessionOptions.maxAge = sessData._maxAge; //>>> each session may have different maxAge 
        this[k] = sessData[k];
      }
    }
  }

  /**
   * JSON representation of the session.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    const obj = {};

    Object.keys(this).forEach(key => {
      if (key === 'isNew') return;
      if (key[0] === '_') return;
      obj[key] = this[key];
    });

    return obj;
  }

  /**
   *
   * alias to `toJSON`
   * @api public
   */

  [inspect]() {
    return this.toJSON();
  }

  /**
   * Return how many values there are in the session object.
   * Used to see if it's "populated".
   *
   * @return {Number}
   * @api public
   */

  get length() {
    return Object.keys(this.toJSON()).length;
  }

  /**
   * populated flag, which is just a boolean alias of .length.
   *
   * @return {Boolean}
   * @api public
   */

  get populated() {
    return !!this.length;
  }

  /**
   * get session maxAge
   *
   * @return {Number}
   * @api public
   */

  get maxAge() {
    return this._ctx.sessionOptions.maxAge;
  }

  /**
   * set session maxAge
   *
   * @param {Number}
   * @api public
   */

  set maxAge(val) {
    this._ctx.sessionOptions.maxAge = val;
    // maxAge changed, must save to cookie and store
    this._requireSave = true;
  }

  /**
   * get session key
   * only exist if opts.store present
   */
  get sessionId() {
    return this._sessionId;
  }

  /**
   * save this session no matter whether it is populated
   *
   * @api public
   */

  save() {
    this._requireSave = true;
  }

  /**
   * commit this session's headers if autoCommit is set to false
   *
   * @api public
   */

  async manuallyCommit() {
    await this._sessCtx.commit();
  }

}