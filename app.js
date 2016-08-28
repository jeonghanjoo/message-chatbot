'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.use(bodyParser.json());
app.use(express.static('public'));

const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET : config.get('appSecret');

const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) : config.get('validationToken');

const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) : config.get('pageAccessToken');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
  console.error("Missing config values");
  process.exit(1);
}

getStarted();

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 */

app.get('/webhook', function (req, res) {

  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. wrong Token");
    res.sendStatus(403);
  }
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 */
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {

        // receive 라는 것은 봇의 관점에서 receive다.
        // 즉, 유저가 채팅을 시작했다는 의미이다.
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent);
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    // Assume all went well.
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * Authorization Event
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference#auth
 */
function receivedAuthentication(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfAuth = event.timestamp;
  var passThroughParam = event.optin.ref;

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#received_message
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 */

// 받는 메세지.(어떤 메세지가 페이스북 페이지에 보내졌을때 이 함수 이벤트가 불린다.)
function receivedMessage(event) {

  var senderID = event.sender.id;
  var sender = event.sender.id.toString();
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;
  var messageId = message.mid;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  if (messageText) {
    console.log('보낸 메세지 : ' + messageText);

    uploadImageMessage(senderID);

    // 서버로 보내는 부분 추가.
    var options = {
      uri: 'http://mojitok.ap-northeast-2.elasticbeanstalk.com/recommend',
      method: 'POST',
      json: {
        TEXT: messageText
      }
    };

    // request(options, function (error, response, body) {
    //   if (!error && response.statusCode == 200) {
    //     var first = body.EMOTICONS[0];
    //     sendImageMessage(senderID, first);
    //   }
    // });
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference#message_delivery
 */
function receivedDeliveryConfirmation(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var delivery = event.delivery;
  var messageIDs = delivery.mids;
  var watermark = delivery.watermark;
  var sequenceNumber = delivery.seq;

  if (messageIDs) {
    messageIDs.forEach(function (messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }
}

/*
 * Postback Event
 * This event is called when a postback is tapped on a Structured Message. Read
 * more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#postback
 */
function receivedPostback(event) {
  var senderID = event.sender.id;
  sendTextMessage(senderID, "안녕하세요!!\n 저는 페이스북 봇입니다");
}




/*
 * Send a message with an using the Send API.
 *
 */
function sendImageMessage(recipientId, firstimage) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: "https://s3.ap-northeast-2.amazonaws.com/mojitok-bucket/" + firstimage
        }
      }
    }
  };
  callSendAPI(messageData);
}

function uploadImageMessage(recipientId) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    form : {
      recipient : {"id": recipientId},
      message: {"attachment": {"type" : "image", "payload" : {}}},
      filedata: "./tmp/1.jpg"
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}


function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: { id: recipientId },
    message: { text: messageText }
  };
  callSendAPI(messageData);
}


function getStarted() {
  var messageData = {
    "setting_type": "call_to_actions",
    "thread_state": "new_thread",
    "call_to_actions": [
      {
        "payload": "USER_DEFINED_PAYLOAD"
      }
    ]
  };
  callThreadAPI(messageData);
}
/**
 *   -F recipient='{"id":"USER_ID"}' \
  -F message='{"attachment":{"type":"image", "payload":{}}}' \
  -F filedata=@/tmp/shirt.png \
 * 
 */
function callUploadAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    form : {
      recipient : {"id": messageData.recipient.id},
      message: {"attachment": {"type" : "image", "payload" : {}}},
      filedata: "./tmp/1.jpg"
    }
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}


/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 */
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}

function callThreadAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/thread_settings',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;
      console.log("Successfully sent Thread Setting");
    } else {
      console.error("Unable to Thread Setting.");
      console.error(response);
      console.error(error);
    }
  });
}
// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'));
});
module.exports = app;
