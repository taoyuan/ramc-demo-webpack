/*jshint -W069 */
"use strict";
(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    return define(['superagent'], factory);
  } else if (typeof module === 'object' && module.exports) {
    // CommonJS-like environments that support module.exports, like Node.
    return module.exports = factory(require(typeof window === "object" ? 'superagent/lib/client' : 'superagent'));
  } else {
    // Browser globals (root is window)
    if (!root.Client) {
      root.Client = {};
    }
    return root.Client = factory(root.superagent);
  }
}(this, function(superagent) {

  function create(options) {
    const exports = {};

    // Requestor definition
    const Requestor = (function(superagent) {
      /**
       * @module Requestor
       * @version 1.0.0
       */

      /**
       * Manages low level client-server communications, parameter marshalling, etc. There should not be any need for an
       * application to use this class directly - the *Api and model classes provide the public API for the service. The
       * contents of this file should be regarded as internal but are documented for completeness.
       * @alias module:Requestor
       * @class
       */
      function Requestor() {

        /**
         * The base URL against which to resolve every API call's (relative) path.
         * @type {String}
         * @default http://petstore-api.herokuapp.com/pet
         */
        this.baseUrl = 'http://petstore-api.herokuapp.com/pet';

        /**
         * The authentication methods to be included for all API calls.
         * @type {Array.<String>}
         */
        this.authentications = {};
        /**
         * The default HTTP headers to be included for all API calls.
         * @type {Array.<String>}
         * @default {}
         */
        this.defaultHeaders = {
          'User-Agent': 'ramc'
        };

        /**
         * The default HTTP timeout for all API calls.
         * @type {Number}
         * @default 60000
         */
        this.timeout = 60000;
      }

      if (global.Promise) {
        Requestor.Promise = global.Promise;
      }

      Requestor.prototype.configure = function(options) {
        if (typeof options === 'string') {
          options = {
            baseUrl: options
          };
        }
        options = options || {};

        if (options.baseUrl) {
          this.baseUrl = options.baseUrl;
        }
      };

      Requestor.prototype.auth = function(name, data) {
        if (typeof name === 'object') {
          data = name;
          name = null;
        }
        name = name || 'default';

        if (!data) {
          throw new Error('Authentication data is required');
        }

        if (!data.type) {
          if (data.username) {
            data.type = 'basic';
          } else if (data.apiKey) {
            data.type = 'api';
          } else if (data.accessToken) {
            data.type = 'oauth2';
          } else {
            throw new Error('Unknown authentication data: ' + data);
          }
        }

        this.authentications[name] = data;
      };

      Requestor.prototype.removeAuth = function(name) {
        name = name || 'default';
        delete this.authentications[name];
      }

      /**
       * Returns a string representation for an actual parameter.
       * @param param The actual parameter.
       * @returns {String} The string representation of <code>param</code>.
       */
      Requestor.prototype.paramToString = function(param) {
        if (param == undefined || param == null) {
          return '';
        }
        if (param instanceof Date) {
          return param.toJSON();
        }
        return param.toString();
      };

      /**
       * Builds full URL by appending the given path to the base URL and replacing path parameter place-holders with parameter values.
       * NOTE: query parameters are not handled here.
       * @param {String} path The path to append to the base URL.
       * @param {Object} pathParams The parameter values to append.
       * @returns {String} The encoded path with parameter values substituted.
       */
      Requestor.prototype.buildUrl = function(path, pathParams) {
        if (!path.match(/^\//)) {
          path = '/' + path;
        }
        var url = this.baseUrl + path;
        var that = this;
        url = url.replace(/\{([\w-]+)\}/g, function(fullMatch, key) {
          var value;
          if (pathParams.hasOwnProperty(key)) {
            value = that.paramToString(pathParams[key]);
          } else {
            value = fullMatch;
          }
          return encodeURIComponent(value);
        });
        return url;
      };

      /**
       * Checks whether the given content type represents JSON.<br>
       * JSON content type examples:<br>
       * <ul>
       * <li>application/json</li>
       * <li>application/json; charset=UTF8</li>
       * <li>APPLICATION/JSON</li>
       * </ul>
       * @param {String} contentType The MIME content type to check.
       * @returns {Boolean} <code>true</code> if <code>contentType</code> represents JSON, otherwise <code>false</code>.
       */
      Requestor.prototype.isJsonMime = function(contentType) {
        return Boolean(contentType != null && contentType.match(/^application\/json(;.*)?$/i));
      };

      /**
       * Chooses a content type from the given array, with JSON preferred; i.e. return JSON if included, otherwise return the first.
       * @param {Array.<String>} contentTypes
       * @returns {String} The chosen content type, preferring JSON.
       */
      Requestor.prototype.jsonPreferredMime = function(contentTypes) {
        for (var i = 0; i < contentTypes.length; i++) {
          if (this.isJsonMime(contentTypes[i])) {
            return contentTypes[i];
          }
        }
        return contentTypes[0];
      };

      /**
       * Checks whether the given parameter value represents file-like content.
       * @param param The parameter to check.
       * @returns {Boolean} <code>true</code> if <code>param</code> represents a file.
       */
      Requestor.prototype.isFileParam = function(param) {
        if (!param || typeof param !== 'object') {
          return false;
        }

        // fs.ReadStream
        if (
          typeof window === 'undefined' &&
          typeof require === 'function' &&
          typeof param.read === 'function' &&
          typeof param.end === 'function' &&
          typeof param.bytesRead === 'number'
        ) {
          return true;
        }
        // Buffer in Node.js (avoid webpack to pack Buffer)
        // if (typeof Buffer === 'function' && param instanceof Buffer) {
        if (
          param.constructor && typeof param.constructor.isBuffer === 'function' &&
          param.constructor.isBuffer(param)
        ) {
          return true;
        }
        // Blob in browser
        if (typeof Blob === 'function' && param instanceof Blob) {
          return true;
        }
        // File in browser (it seems File object is also instance of Blob, but keep this for safe)
        if (typeof File === 'function' && param instanceof File) {
          return true;
        }

        return false;
      };

      /**
       * Normalizes parameter values:
       * <ul>
       * <li>remove nils</li>
       * <li>keep files and arrays</li>
       * <li>format to string with `paramToString` for other cases</li>
       * </ul>
       * @param {Object.<String, Object>} params The parameters as object properties.
       * @returns {Object.<String, Object>} normalized parameters.
       */
      Requestor.prototype.normalizeParams = function(params) {
        var newParams = {};
        for (var key in params) {
          if (params.hasOwnProperty(key) && params[key] != undefined && params[key] != null) {
            var value = params[key];
            if (this.isFileParam(value) || Array.isArray(value)) {
              newParams[key] = value;
            } else {
              newParams[key] = this.paramToString(value);
            }
          }
        }
        return newParams;
      };

      /**
       * Enumeration of collection format separator strategies.
       * @enum {String}
       * @readonly
       */
      Requestor.CollectionFormatEnum = {
        /**
         * Comma-separated values. Value: <code>csv</code>
         * @const
         */
        CSV: ',',
        /**
         * Space-separated values. Value: <code>ssv</code>
         * @const
         */
        SSV: ' ',
        /**
         * Tab-separated values. Value: <code>tsv</code>
         * @const
         */
        TSV: '\t',
        /**
         * Pipe(|)-separated values. Value: <code>pipes</code>
         * @const
         */
        PIPES: '|',
        /**
         * Native array. Value: <code>multi</code>
         * @const
         */
        MULTI: 'multi'
      };

      /**
       * Builds a string representation of an array-type actual parameter, according to the given collection format.
       * @param {Array} param An array parameter.
       * @param {module:Requestor.CollectionFormatEnum} collectionFormat The array element separator strategy.
       * @returns {String|Array} A string representation of the supplied collection, using the specified delimiter. Returns
       * <code>param</code> as is if <code>collectionFormat</code> is <code>multi</code>.
       */
      Requestor.prototype.buildCollectionParam = function buildCollectionParam(param, collectionFormat) {
        if (param == null) {
          return null;
        }
        switch (collectionFormat) {
          case 'csv':
            return param.map(this.paramToString).join(',');
          case 'ssv':
            return param.map(this.paramToString).join(' ');
          case 'tsv':
            return param.map(this.paramToString).join('\t');
          case 'pipes':
            return param.map(this.paramToString).join('|');
          case 'multi':
            // return the array directly as SuperAgent will handle it as expected
            return param.map(this.paramToString);
          default:
            throw new Error('Unknown collection format: ' + collectionFormat);
        }
      };

      /**
       * Applies authentication headers to the request.
       * @param {Object} request The request object created by a <code>superagent()</code> call.
       * @param {Array.<String>} authNames An array of authentication method names.
       */
      Requestor.prototype.applyAuthToRequest = function(request, authNames) {
        var that = this;
        if (!authNames || !authNames.length) {
          authNames = ['default'];
        }
        authNames.forEach(function(authName) {
          var auth = that.authentications[authName];
          if (!auth) return;
          switch (auth.type) {
            case 'basic':
              if (auth.username || auth.password) {
                request.auth(auth.username || '', auth.password || '');
              }
              break;
            case 'apiKey':
              if (auth.apiKey) {
                var data = {};
                if (auth.apiKeyPrefix) {
                  data[auth.name] = auth.apiKeyPrefix + ' ' + auth.apiKey;
                } else {
                  data[auth.name] = auth.apiKey;
                }
                if (auth['in'] === 'query') {
                  request.query(data);
                } else {
                  request.set(data);
                }
              }
              break;
            case 'oauth2':
              if (auth.accessToken) {
                if (auth.name) {
                  var data = {};
                  data[auth.name] = auth.accessToken;
                  if (auth['in'] === 'query') {
                    request.query(data);
                  } else {
                    request.set(data);
                  }
                } else {
                  request.set({
                    'Authorization': 'Bearer ' + auth.accessToken
                  });
                }
              }
              break;
            default:
              throw new Error('Unknown authentication type: ' + auth.type);
          }
        });
      };

      /**
       * Deserializes an HTTP response body into a value of the specified type.
       * @param {Object} response A SuperAgent response object.
       * @param {(String|Array.<String>|Object.<String, Object>|Function)} returnType The type to return. Pass a string for simple types
       * or the constructor function for a complex type. Pass an array containing the type name to return an array of that type. To
       * return an object, pass an object with one property whose name is the key type and whose value is the corresponding value type:
       * all properties on <code>data<code> will be converted to this type.
       * @returns A value of the specified type.
       */
      Requestor.prototype.deserialize = function deserialize(response, returnType) {
        if (response == null || returnType == null) {
          return null;
        }
        // Rely on SuperAgent for parsing response body.
        // See http://visionmedia.github.io/superagent/#parsing-response-bodies
        var data = response.body;
        if (data == null) {
          // SuperAgent does not always produce a body; use the unparsed response as a fallback
          data = response.text;
        }
        return Requestor.convertToType(data, returnType);
      };

      /**
       * Parses an ISO-8601 string representation of a date value.
       * @param {String} str The date value as a string.
       * @returns {Date} The parsed date object.
       */
      Requestor.parseDate = function(str) {
        return new Date(str.replace(/T/i, ' '));
      };

      /**
       * Converts a value to the specified type.
       * @param {(String|Object)} data The data to convert, as a string or object.
       * @param {(String|Array.<String>|Object.<String, Object>|Function)} type The type to return. Pass a string for simple types
       * or the constructor function for a complex type. Pass an array containing the type name to return an array of that type. To
       * return an object, pass an object with one property whose name is the key type and whose value is the corresponding value type:
       * all properties on <code>data<code> will be converted to this type.
       * @returns An instance of the specified type.
       */
      Requestor.convertToType = function(data, type) {
        switch (type) {
          case 'Boolean':
            return Boolean(data);
          case 'Integer':
            return parseInt(data, 10);
          case 'Number':
            return parseFloat(data);
          case 'String':
            return String(data);
          case 'Date':
            return this.parseDate(String(data));
          default:
            if (type === Object) {
              // generic object, return directly
              return data;
            } else if (typeof type === 'function') {
              // for model type like: User
              return type.create(data);
            } else if (Array.isArray(type)) {
              // for array type like: ['String']
              var itemType = type[0];
              return data.map(function(item) {
                return Requestor.convertToType(item, itemType);
              });
            } else if (typeof type === 'object') {
              // for plain object type like: {'String': 'Integer'}
              var keyType, valueType;
              for (var k in type) {
                if (type.hasOwnProperty(k)) {
                  keyType = k;
                  valueType = type[k];
                  break;
                }
              }
              var result = {};
              for (var k in data) {
                if (data.hasOwnProperty(k)) {
                  var key = Requestor.convertToType(k, keyType);
                  var value = Requestor.convertToType(data[k], valueType);
                  result[key] = value;
                }
              }
              return result;
            } else {
              // for unknown type, return the data directly
              return data;
            }
        }
      };

      /**
       * Constructs a new map or array model from REST data.
       * @param data {Object|Array} The REST data.
       * @param obj {Object|Array} The target object or array.
       */
      Requestor.create = function(data, obj, itemType) {
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            if (data.hasOwnProperty(i))
              obj[i] = Requestor.convertToType(data[i], itemType);
          }
        } else {
          for (var k in data) {
            if (data.hasOwnProperty(k))
              obj[k] = Requestor.convertToType(data[k], itemType);
          }
        }
      };

      /**
       * Callback function to receive the result of the operation.
       * @callback module:Requestor~callApiCallback
       * @param {String} error Error message, if any.
       * @param data The data returned by the service call.
       * @param {String} response The complete HTTP response.
       */

      /**
       * Invokes the REST service using the supplied settings and parameters.
       * @param {String} path The base URL to invoke.
       * @param {String} httpMethod The HTTP method to use.
       * @param {Object.<String, String>} pathParams A map of path parameters and their values.
       * @param {Object.<String, Object>} queryParams A map of query parameters and their values.
       * @param {Object.<String, Object>} headerParams A map of header parameters and their values.
       * @param {Object.<String, Object>} formParams A map of form parameters and their values.
       * @param {Object} bodyParam The value to pass as the request body.
       * @param {Array.<String>} authNames An array of authentication type names.
       * @param {Array.<String>} contentTypes An array of request MIME types.
       * @param {Array.<String>} accepts An array of acceptable response MIME types.
       * @param {(String|Array|ObjectFunction)} returnType The required type to return; can be a string for simple types or the
       * constructor for a complex type.
       * @param {module:Requestor~requestCallback} callback The callback function.
       * @returns {Object} The SuperAgent request object.
       */
      Requestor.prototype.request = function(path, httpMethod, pathParams,
        queryParams, headerParams, formParams, bodyParam, authNames, contentTypes, accepts,
        returnType, callback) {

        var that = this;
        var url = this.buildUrl(path, pathParams);
        var request = superagent(httpMethod, url);

        // apply authentications
        this.applyAuthToRequest(request, authNames);

        // set query parameters
        request.query(this.normalizeParams(queryParams));

        // set header parameters
        request.set(this.defaultHeaders).set(this.normalizeParams(headerParams));

        // set request timeout
        request.timeout(this.timeout);

        var contentType = this.jsonPreferredMime(contentTypes);
        if (contentType) {
          request.type(contentType);
        } else if (!request.header['Content-Type']) {
          request.type('application/json');
        }

        if (contentType === 'application/x-www-form-urlencoded') {
          request.send(this.normalizeParams(formParams));
        } else if (contentType == 'multipart/form-data') {
          var _formParams = this.normalizeParams(formParams);
          for (var key in _formParams) {
            if (_formParams.hasOwnProperty(key)) {
              if (this.isFileParam(_formParams[key])) {
                // file field
                request.attach(key, _formParams[key]);
              } else {
                request.field(key, _formParams[key]);
              }
            }
          }
        } else if (bodyParam) {
          request.send(bodyParam);
        }

        var accept = this.jsonPreferredMime(accepts);
        if (accept) {
          request.accept(accept);
        }

        function fetch(done) {
          return request.end(function(err, res) {
            if (!err) {
              res.data = that.deserialize(res, returnType);
            }
            if (done) {
              done(err, res);
            }
          });
        }

        if (Requestor.Promise) {
          return new Requestor.Promise(function(resolve, reject) {
            fetch(function(err, res) {
              if (callback) {
                callback(err, res);
              }
              if (err) {
                reject(err);
              } else {
                resolve(res);
              }
            });
          });
        } else {
          fetch(callback);
        }
      };

      /**
       * The default API client implementation.
       * @type {module:Requestor}
       */
      Requestor.instance = new Requestor();

      return Requestor;
    })(superagent);
    const requestor = new Requestor();

    exports.Requestor = Requestor;
    exports.requestor = requestor;

    Object.keys(requestor).concat(Object.keys(Requestor.prototype)).forEach(function(name) {
      if (typeof requestor[name] === 'function') {
        exports[name] = function() {
          return requestor[name].apply(requestor, arguments);
        }
      }
    });

    Object.defineProperty(exports, 'Promise', {
      get: function() {
        return Requestor.Promise;
      },
      set: function(value) {
        Requestor.Promise = value;
      }
    })

    options && exports.configure(options);

    // Models definitions
    const models = {};
    models['Pet'] = (function(Requestor, _requestor) {

      /**
       * The Pet model module.
       * @module model/Pet
       * @version 1.0.0
       */

      /**
       * Constructs a new <code>Pet</code>.
       * @alias module:model/Pet
       * @class
       */
      function Pet() {

      }

      /**
       * Constructs a <code>Pet</code> from a plain JavaScript object, optionally creating a new instance.
       * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
       * @param {Object} data The plain JavaScript object bearing properties of interest.
       * @param {module:model/Pet } obj Optional instance to populate.
       * @return {module:model/Pet } The populated <code>Pet</code> instance.
       */
      Pet.create = function(data, obj) {
        if (data) {
          obj = obj || new Pet();

          if (data.hasOwnProperty('name')) {
            obj['name'] = Requestor.convertToType(data['name'], 'String');
          }
          if (data.hasOwnProperty('birthday')) {
            obj['birthday'] = Requestor.convertToType(data['birthday'], 'Integer');
          }
        }
        return obj;
      };

      /**
       * 
       * @member { String } name
       */
      Pet.prototype['name'] = undefined;
      /**
       * 
       * @member { Integer } birthday
       */
      Pet.prototype['birthday'] = undefined;

      return Pet;
    })(Requestor, requestor);

    // Services definitions
    const API = (function(Requestor, _requestor) {
      /**
       * API service.
       * @module api/API
       * @version 1.0.0
       */

      /**
       * Constructs a new API.
       * @alias module:api/API
       * @class
       * @param {module:Requestor} [requestor] Optional API client implementation to use,
       * default to {@link module:Requestor#instance} if unspecified.
       */
      function API(requestor) {
        if (!(this instanceof API)) {
          return new API(requestor);
        }

        this.requestor = requestor || _requestor;

        this.get = function(opts, cb) {
          if (typeof opts === 'function') {
            cb = opts;
            opts = null;
          }
          opts = opts || {};

          var pathParams = {};
          var queryParams = {};
          var headerParams = {};
          var formParams = {};

          queryParams['limit'] = opts['limit'];

          var postBody = null;

          var authNames = [];
          var contentTypes = ['application/json', 'text/xml'];
          var accepts = ['application/json', 'text/html'];
          var returnType = Object;

          return this.requestor.request(
            '/', 'GET',
            pathParams, queryParams, headerParams, formParams, postBody,
            authNames, contentTypes, accepts, returnType, cb
          );
        };
        this.post = function(pet, cb) {
          // verify the required parameter 'pet' is set
          if (pet == undefined || pet == null) {
            throw new Error("Missing the required parameter 'pet' when calling post");
          }

          var pathParams = {};
          var queryParams = {};
          var headerParams = {};
          var formParams = {};

          var postBody = null;
          postBody = pet;

          var authNames = [];
          var contentTypes = ['application/json', 'text/xml'];
          var accepts = ['application/json', 'text/html'];
          var returnType = Object;

          return this.requestor.request(
            '/', 'POST',
            pathParams, queryParams, headerParams, formParams, postBody,
            authNames, contentTypes, accepts, returnType, cb
          );
        };
        this.put = function(pet, cb) {
          // verify the required parameter 'pet' is set
          if (pet == undefined || pet == null) {
            throw new Error("Missing the required parameter 'pet' when calling put");
          }

          var pathParams = {};
          var queryParams = {};
          var headerParams = {};
          var formParams = {};

          var postBody = null;
          postBody = pet;

          var authNames = [];
          var contentTypes = ['application/json', 'text/xml'];
          var accepts = ['application/json', 'text/html'];
          var returnType = Object;

          return this.requestor.request(
            '/', 'PUT',
            pathParams, queryParams, headerParams, formParams, postBody,
            authNames, contentTypes, accepts, returnType, cb
          );
        };
        this.getByPetId = function(petId, cb) {
          // verify the required parameter 'petId' is set
          if (petId == undefined || petId == null) {
            throw new Error("Missing the required parameter 'petId' when calling getByPetId");
          }

          var pathParams = {};
          var queryParams = {};
          var headerParams = {};
          var formParams = {};

          pathParams['petId'] = petId;

          var postBody = null;

          var authNames = [];
          var contentTypes = ['application/json', 'text/xml'];
          var accepts = ['application/json', 'text/html'];
          var returnType = Object;

          return this.requestor.request(
            '/{petId}', 'GET',
            pathParams, queryParams, headerParams, formParams, postBody,
            authNames, contentTypes, accepts, returnType, cb
          );
        };

      }

      return API;
    })(Requestor, requestor);

    // Export models
    exports.models = models;

    // Export services
    exports.API = API;

    exports.create = create;

    return exports;
  }

  return create();
}));