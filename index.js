'use strict';

// Config
require('dotenv').load({ silent: true });

// Required Libs
const cfenv  = require('cfenv');
const Hapi   = require('hapi');
const Path   = require('path');
const Amqp = require('amqplib/callback_api');
const Cloudant = require('cloudant');

// Initialize the library with my account.
var cloudant = Cloudant({
  account: process.env.CLOUDANT_ACCOUNT,
  username: process.env.CLOUDANT_KEY,
  password: process.env.CLOUDANT_PASSWORD,
}).db.use(process.env.CLOUDANT_DB);

// Handle Configs
const appEnv = cfenv.getAppEnv();

// Instantiate the server
const server = new Hapi.Server({
  debug: {
    request: ['error', 'good'],
  },
  connections: {
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public'),
      },
    },
  },
});

// Set Hapi Connections
server.connection({
  host: appEnv.bind || 'localhost',
  port: appEnv.port || process.env.PORT || 5000,
});

// Hapi Log
server.log(['error', 'database', 'read']);

// Hapi Plugins
const hapiErr = function (err) {
  if (err) console.log(err);
};

// Register bell with the server
server.register([
  require('inert'),
  require('vision'),
  require('hapi-auth-cookie'),
  require('bell')], (err) => {

    if (err) {
        throw err;
    }

    server.views({
      engines: { jade: require('jade') },
      path: __dirname + '/templates',
      compileOptions: {
        pretty: true,
      },
    });

    //Setup the session strategy
    server.auth.strategy('session', 'cookie', {
      password: 'secret_cookie_encryption_password', //Use something more secure in production
      redirectTo: '/auth/twitter', //If there is no session, redirect here
      isSecure: false //Should be set to true (which is the default) in production
    });

    // Declare an authentication strategy using the bell scheme
    // with the name of the provider, cookie encryption password,
    // and the OAuth client credentials.
    server.auth.strategy('twitter', 'bell', {
        provider: 'twitter',
        password: '7yD3zQ2frRJsHmpVeKWp7yD3zQ2frRJsHmpVeKWp',
        clientId: process.env.TWITTER_KEY,
        clientSecret: process.env.TWITTER_SECRET,
        isSecure: false     // Terrible idea but required if not using HTTPS especially if developing locally
    });

    // Use the 'twitter' authentication strategy to protect the
    // endpoint handling the incoming authentication credentials.
    // This endpoints usually looks up the third party account in
    // the database and sets some application state (cookie) with
    // the local application account information.
    server.route({
      method: 'GET',
      path: '/auth/twitter',
      config: {
        auth: 'twitter', //<-- use our twitter strategy and let bell take over
        handler: function(request, reply) {

          cloudant.get('settings', function(err, body) {

            if (!request.auth.isAuthenticated) {
              return reply(Boom.unauthorized('Authentication failed: ' + request.auth.error.message));
            }

            //Just store a part of the twitter profile information in the session as an example. You could do something
            //more useful here - like loading or setting up an account (social signup).
            const profile = request.auth.credentials.profile;

            request.cookieAuth.set({
              twitterId: profile.id,
              username: profile.username,
              displayName: profile.displayName
            });

            return reply.redirect('/dash');
          });
        }
      }
    });

    server.route({
      method: 'GET',
      path: '/',
      config: {
        handler: function (request, reply) {
          return reply.view('index');
        },
      },
    });

    server.route({
      method: 'GET',
      path: '/dash',
      config: {
        auth: 'twitter',
        handler: function (request, reply) {
          return reply.view('dash');
        },
      },
    });

    server.route({
      method: 'POST',
      path: '/send',
      config: {
        handler: function (request, reply) {
          cloudant.get('settings', function(err, body) {
            if (err)
              console.error(err);
            const fromNumber = body.number;
            const content = body.prefix + request.payload.msg + body.suffix;
            cloudant.view('send', 'allowed', { include_docs: true }, function(err, body) {
              if (!err) {
                body.rows.forEach(function(doc) {
                  Amqp.connect(process.env.RABBIT, function(err, conn) {
                    conn.createChannel(function(err, ch) {
                      var q = 'notifications';

                      ch.assertQueue(q, {durable: false});
                      // Note: on Node 6 Buffer.from(msg) should be used
                      var msg = {
                        to: doc.value,
                        from: fromNumber,
                        msg: content
                      }
                      ch.sendToQueue(q, new Buffer(JSON.stringify(msg)));
                      console.log(" [x] Sent '"+JSON.stringify(msg)+"'");
                    });
                  });
                });
              }
            });
          });
          return reply({
            sent: true,
          });
        },
      },
    });

    server.route({
      method: 'GET',
      path: '/update',
      config: {
        handler: function (request, reply) {
          const content = request.query.text.toLowerCase();
          const keyword = request.query.keyword.toLowerCase();
          const updateNumber = request.query.msisdn;
          const timestamp = request.query['message-timestamp'];
          if (content == 'stop' || keyword == 'stop') {
            cloudant.view('send', 'update', { include_docs: true, keys: [updateNumber] }, function(err, body) {
              if (!err) {
                body.rows.forEach(function(doc) {
                  var updateDoc = doc.doc
                  updateDoc.stop = timestamp;
                  cloudant.insert(updateDoc, function(err, body) {
                    if (err)
                      console.error(err)
                    reply({
                      update: updateNumber,
                    });
                  })
                });
              }
            });
          }
        },
      },
    });

    server.route({
      method: 'GET',
      path: '/app.js',
      handler: {
        file: 'app.js',
      },
    });

    server.route({
        method: 'GET',
        path: '/{param*}',
        handler: {
            directory: {
                path: 'public'
            }
        }
    });

    // Start Hapi
    server.start(function (err) {
      if (err) {
        hapiErr(err);
      } else {
        console.log('Server started at: ' + server.info.uri);
      }
    });

});
