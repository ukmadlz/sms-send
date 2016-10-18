'use strict';

require('dotenv').load({ silent: true });

var amqp = require('amqplib/callback_api');

var Nexmo = require('nexmo');
var nexmo = new Nexmo({
    apiKey: process.env.NEXMO_KEY,
    apiSecret: process.env.NEXMO_SECRET,
}, {
  debug: true,
});

amqp.connect(process.env.RABBIT, function(err, conn) {
  if (err) console.error(err);
  conn.createChannel(function(err, ch) {
    var q = 'notifications';

    ch.assertQueue(q, {durable: false});

    console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
    ch.consume(q, function(msg) {
      console.log(" [x] Received %s", msg.content.toString());
      var sms = JSON.parse(msg.content.toString());
      nexmo.message.sendSms(sms.from, sms.to, sms.msg, {}, function(err, resp) {
        if (err) {
          console.error(err, resp);
        } else {
          console.log(" [x] SMS sent to %s", sms.to);
        }
      });
    }, {noAck: true});
  });
});
