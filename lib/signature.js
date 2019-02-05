var crypto = require('crypto');
var querystring = require('querystring');
var sortKeys = require('sort-object');
var Buffer = require('safe-buffer').Buffer;
var getRawBody = require('raw-body')
var scmp = require('scmp');
var extend = Object.assign ? Object.assign : require('util')._extend;

var MESSAGEBIRD_REQUEST_TIMESTAMP = 'messagebird-request-timestamp';
var MESSAGEBIRD_REQUEST_SIGNATURE = 'messagebird-signature';
var MESSAGEBIRD_REQUEST_TIMEOUT = 100;
var MESSAGEBIRD_REQUEST_HASH = 'sha256';

/**
 * Returns request is expired or not.
 *
 * @param {Object} req
 * @return {Boolean}
 */
function isRecent(req) {
  var timestamp = req.headers[MESSAGEBIRD_REQUEST_TIMESTAMP];
  var currentTime = Math.floor(new Date().getTime() / 1000);

  if (!timestamp) {
    throw new Error('The "MessageBird-Request-Timestamp" header is missing.');
  }

  if(!(new Date(timestamp).getTime() > 0)) {
    throw new Error('The "MessageBird-Request-Timestamp" has an invalid value.'); 
  }

  return (currentTime - parseInt(timestamp, 10)) < MESSAGEBIRD_REQUEST_TIMEOUT;
}

/**
 * Returns signatures are equal or not.
 *
 * @param {Object} req
 * @param {Buffer} generatedSignature
 * @return {Boolean}
 */
function isValid(req, generatedSignature) {
  var signature = req.headers[MESSAGEBIRD_REQUEST_SIGNATURE];

  if (!signature) {
    throw new Error('The "MessageBird-Signature" header is missing.');
  }

  return scmp(Buffer.from(signature, 'base64'), generatedSignature);
}

/**
 * Returns sorted queryString with parsed statusDatetime
 *
 * @param {Object} obj
 * @return {String}
 */
function stringifyQuery(query) {
  var normalizedDateTime = query.statusDatetime ? extend(query, { statusDatetime: query.statusDatetime.split(' ').join('+') }) : query;
  var sortedQuery = sortKeys(normalizedDateTime);

  return querystring.stringify(sortedQuery);
}

/**
 * Generates signature.
 *
 * @param {Object} req
 * @param {String} signingKey
 * @return {Buffer}
 */
function generate(req, signingKey) {
  var getTimeAndQueryBuffer = function () {
    var timestamp = req.headers[MESSAGEBIRD_REQUEST_TIMESTAMP];
    var queryParams = stringifyQuery(req.query);

    return new Buffer.from(timestamp + '\n' + queryParams + '\n');
  };

  var getBodyBuffer = function () {
    var bodyHash = crypto.createHash(MESSAGEBIRD_REQUEST_HASH).update(req.rawBody).digest();

    return new Buffer.from(bodyHash);
  };

  if (!req.headers[MESSAGEBIRD_REQUEST_TIMESTAMP]) {
    throw new Error('The "MessageBird-Request-Timestamp" header is missing.');
  }

  var payload = new Buffer.concat([getTimeAndQueryBuffer(req), getBodyBuffer(req)]);
  return crypto.createHmac(MESSAGEBIRD_REQUEST_HASH, signingKey).update(payload).digest();
}

/**
 * Returns request is valid or not.
 *
 * @param {Object} req
 * @param {String} signingKey
 * @return {Boolean}
 */
function validate(req, signingKey) {
  var signature = generate(req, signingKey);

  if (!isValid(req, signature)) {
    throw new Error('Signatures not match.');
  }

  if (!isRecent(req)) {
    throw new Error('Request expired.');
  }

  return true;
}

/**
 * Middleware for express.
 *
 * @param {String} signingKey
 * @return {Function}
 */
function middlewareWrapper(signingKey) {
  return function signatureMiddleware(req, res, next) {
    getRawBody(req, {
      length: req.headers['content-length'],
      limit: '100kb',
      encoding: true
    }, function (err, rawBody) {
      if (err) { 
        return next(err);
      }

      req.rawBody = rawBody || '';

      if (validate(req, signingKey)) {
        next();
      } else {
        throw new Error('Signatures not match.');
      }
    })

  };
}

exports = module.exports = middlewareWrapper;
exports.isValid = isValid;
exports.isRecent = isRecent;
exports.generate = generate;
exports.validate = validate;