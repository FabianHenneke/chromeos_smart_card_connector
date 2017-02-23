/** @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Entry point of the Smart Card Client App background script (see
 * <https://developer.chrome.com/apps/event_pages>).
 *
 * The main pieces performed here are the following:
 * * A GoogleSmartCard.PcscLiteClient.Context object is created and its
 *   initialization is started, which attempts to establish a connection to the
 *   server App. Upon successful connection, a
 *   GoogleSmartCard.PcscLiteClient.API object is received, that can be used to
 *   perform PC/SC-Lite client API requests.
 * * Subscribing to a special Chrome Extensions API event that makes the App
 *   auto-loading.
 */

goog.provide('SmartCardClientApp.BackgroundMain');

goog.require('SmartCardClientApp.PinDialog.Server');
goog.require('GoogleSmartCard.AppUtils');
goog.require('GoogleSmartCard.BackgroundPageUnloadPreventing');
goog.require('GoogleSmartCard.Logging');
goog.require('GoogleSmartCard.PcscLiteClient.API');
goog.require('GoogleSmartCard.PcscLiteClient.Context');
goog.require('GoogleSmartCard.PcscLiteClient.Demo');
goog.require('GoogleSmartCard.PcscLiteCommon.Constants');
goog.require('goog.log');
goog.require('goog.log.Level');
goog.require('goog.log.Logger');

goog.scope(function() {

  /** @const */
  var GSC = GoogleSmartCard;

  /** @const */
  var Constants = GSC.PcscLiteCommon.Constants;

  const API = GoogleSmartCard.PcscLiteClient.API;

  /**
   * Client title for the connection to the server App.
   *
   * Currently this is only used for the debug logs produced by the server App.
   * @const
   */
  var CLIENT_TITLE = 'example_js_client_app';

  /**
   * Identifier of the server App.
   * @const
   */
  var SERVER_APP_ID = Constants.SERVER_OFFICIAL_APP_ID;

  /**
   * Logger that should be used for logging the App log messages.
   * @type {!goog.log.Logger}
   * @const
   */
  var logger = GSC.Logging.getLogger(
    'SmartCardClientApp',
    goog.DEBUG ? goog.log.Level.FINE : goog.log.Level.INFO);

  /**
   * Context for using the PC/SC-Lite client API.
   *
   * This object establishes and manages a connection to the server App. Upon
   * successful connection, a GoogleSmartCard.PcscLiteClient.API object is
   * returned through the callback, that allows to perform PC/SC-Lite client API
   * requests.
   * @type {GSC.PcscLiteClient.Context}
   */
  var context = null;

  /**
   * Initiates the PC/SC-Lite client API context initialization.
   */
  function initializeContext() {
    GSC.Logging.checkWithLogger(logger, goog.isNull(context));
    context = new GSC.PcscLiteClient.Context(CLIENT_TITLE, SERVER_APP_ID);
    context.addOnInitializedCallback(contextInitializedListener);
    context.addOnDisposeCallback(contextDisposedListener);
    context.initialize();
  }

  /**
   * This callback is called when the PC/SC-Lite client API context is
   * successfully initialized.
   * @param {!GSC.PcscLiteClient.API} api Object that allows to perform PC/SC-Lite
   * client API requests.
   */
  function contextInitializedListener(api) {
    logger.info('Successfully connected to the server app');
    work(api);
  }

  /**
   * This callback is called when the PC/SC-Lite client API context is disposed
   * (either it failed to initialize or was disposed later due to some error).
   *
   * The GoogleSmartCard.PcscLiteClient.API that was supplied previously also
   * becomes disposed at this point (if not disposed yet).
   */
  function contextDisposedListener() {
    logger.warning('Connection to the server app was shut down');
    context = null;
    stopWork();
  }

  let getp = sCardPromise => sCardPromise.then(result => new Promise(
    function(resolve, reject) {
      result.get((...args) => args.length > 1 ? resolve(args) : resolve(
        args[0]), reject);
    }).catch(error => console.log(error)));

  function toPci(protocol) {
    return protocol == API.SCARD_PROTOCOL_T0 ?
      API.SCARD_PCI_T0 :
      API.SCARD_PCI_T1;
  }

  async function parseResult(result, transmit) {
    let data = result[1].slice(0, -2);
    let returnCode = result[1].slice(-2);
    if (returnCode[0] === 0x61) {
      console.log('Data continues with ' + returnCode[1] + ' bytes.');
      let result = await getp(transmit(GET_RESPONSE_APDU));
      let dataContinued = await parseResult(result, transmit);
      data = data.concat(dataContinued);
    } else if (!(returnCode[0] === 0x90 && returnCode[1] === 0x00))
      console.log('Operation returned specific status bytes:', returnCode);
    return data;
  }

  function bytesToString(bytes) {
    let str = '';
    for (let i = 0; i < bytes.length; i++)
      str += String.fromCharCode(bytes[i]);
    return str;
  }

  // Taken from:
  // http://stackoverflow.com/a/18729931
  function utf8ToBytes(str) {
    var utf8 = [str.length];
    for (var i = 0; i < str.length; i++) {
      var charcode = str.charCodeAt(i);
      if (charcode < 0x80) utf8.push(charcode);
      else if (charcode < 0x800) {
        utf8.push(0xc0 | (charcode >> 6),
          0x80 | (charcode & 0x3f));
      } else if (charcode < 0xd800 || charcode >= 0xe000) {
        utf8.push(0xe0 | (charcode >> 12),
          0x80 | ((charcode >> 6) & 0x3f),
          0x80 | (charcode & 0x3f));
      }
      // surrogate pair
      else {
        i++;
        // UTF-16 encodes 0x10000-0x10FFFF by
        // subtracting 0x10000 and splitting the
        // 20 bits of 0x0-0xFFFFF into two halves
        charcode = 0x10000 + (((charcode & 0x3ff) << 10) |
          (str.charCodeAt(i) & 0x3ff))
        utf8.push(0xf0 | (charcode >> 18),
          0x80 | ((charcode >> 12) & 0x3f),
          0x80 | ((charcode >> 6) & 0x3f),
          0x80 | (charcode & 0x3f));
      }
    }
    return utf8;
  }

  const SELECT_FILE_APDU = [0x00, 0xA4, 0x04, 0x00, 0x06, 0xD2, 0x76, 0x00,
    0x01, 0x24, 0x01, 0x00
  ];
  const GET_DATA_CARDHOLDER_APDU = [0x00, 0xCA, 0x00, 0x65, 0x00];
  const GET_DATA_URL_APDU = [0x00, 0xCA, 0x5F, 0x50, 0x00];
  const GET_DATA_DSC_APDU = [0x00, 0xCA, 0x00, 0x7A, 0x00];
  const VERIFY_APDU = [0x00, 0x20, 0x00, 0x81];
  const PSO_CDS_APDU = [0x00, 0x2A, 0x9E, 0x9A];
  const RSA_SHA1_DIGEST_INFO = [0x30, 0x51, 0x30, 0x0D, 0x06, 0x09, 0x60,
    0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03, 0x05, 0x00, 0x04,
    0x40
  ];
  const GET_RESPONSE_APDU = [0x00, 0xC0, 0x00, 0x00, 0x00];

  /**
   * This function is executed when the context for using PC/SC-Lite client API is
   * initialized successfully.
   * @param {!GSC.PcscLiteClient.API} api Object that allows to perform PC/SC-Lite
   * client API requests.
   */
  async function work(api) {
    try {
      // Connect
      let sCardContext = await getp(api.SCardEstablishContext(API.SCARD_SCOPE_SYSTEM,
        null, null));
      console.log(sCardContext);
      await getp(api.SCardIsValidContext(sCardContext));
      let readers = await getp(api.SCardListReaders(sCardContext, null));
      console.log(readers);
      let readerName = readers[0];
      let result = await getp(api.SCardConnect(sCardContext, readerName,
        API.SCARD_SHARE_SHARED,
        API.SCARD_PROTOCOL_ANY));
      let sCardHandle = result[0];
      let activeProtocol = result[1];
      console.log(sCardHandle, activeProtocol);
      let transmit = api.SCardTransmit.bind(api, sCardHandle,
        toPci(activeProtocol));

      // Select OpenPGP applet
      let status = (await getp(transmit(SELECT_FILE_APDU)))[1];
      if (!(status[0] === 0x90 && status[1] === 0x00)) {
        console.log('Can\'t connect to OpenPGP applet.');
        return;
      }

      // Request cardholder data and public key url
      result = await getp(transmit(GET_DATA_CARDHOLDER_APDU));
      let data = await parseResult(result, transmit);
      console.log(data);
      result = await getp(transmit(GET_DATA_URL_APDU));
      data = await parseResult(result, transmit);
      let url = bytesToString(data);
      console.log('URL: ' + url);

      // Request PIN
      let pinBytes = [];
      try {
        let pin = await SmartCardClientApp.PinDialog.Server.requestPin();
        console.log('PIN dialog: PIN=' + pin);
        pinBytes = utf8ToBytes(pin);
        console.log('Encoded PIN: ', pinBytes);
      } catch (error) {
        console.log('PIN dialog: ' + error);
        return;
      }

      // Verify PIN
      result = await getp(transmit(VERIFY_APDU.concat(pinBytes)));
      data = await parseResult(result, transmit);
      console.log(data);

      // Get digital signature counter
      result = await getp(transmit(GET_DATA_DSC_APDU));
      data = await parseResult(result, transmit);
      console.log('DSC: ', data);

      // Sign
      // let message = 'Hello YubiKey!';
      // Precomputed SHA512 hash
      let hash = [0xfb, 0xd6, 0x35, 0x88, 0x31, 0x09, 0x2c, 0xde, 0x71,
        0xcb, 0x42, 0x11, 0x89, 0x35, 0x10, 0xb3, 0xc9, 0x3b, 0x4d, 0x4c,
        0x21, 0xa9, 0x53, 0xbf, 0x46, 0x37, 0x68, 0x19, 0x7a, 0xe4, 0x11,
        0x9f, 0xa8, 0x8d, 0xe8, 0x0a, 0xbd, 0xa1, 0xc2, 0x0c, 0x03, 0x5f,
        0x70, 0xae, 0x55, 0x1a, 0xfe, 0xe3, 0xe7, 0xa8, 0x27, 0x67, 0xa6,
        0x5b, 0xb6, 0xcb, 0xce, 0x08, 0xd2, 0xfe, 0xbf, 0x93, 0x60, 0x71
      ];
      let digestInfo = RSA_SHA1_DIGEST_INFO.concat(hash);
      result = await getp(transmit(PSO_CDS_APDU.concat([digestInfo.length])
        .concat(digestInfo).concat([0x00])));
      let signature = await parseResult(result, transmit);
      console.log(signature);

      // Get digital signature counter
      result = await getp(transmit(GET_DATA_DSC_APDU));
      data = await parseResult(result, transmit);
      console.log('DSC: ', data);

      // Disconnect
      await getp(api.SCardDisconnect(sCardHandle, API.SCARD_LEAVE_CARD));
      await getp(api.SCardReleaseContext(sCardContext));
    } catch (pcscError) {
      logPcscError(api, pcscError);
      return;
    }
  }

  async function logPcscError(api, errorCode) {
    console.log('failed: PC/SC-Lite error: ' + errorCode);
    try {
      let errorText = await api.pcsc_stringify_error(errorCode);
      console.log('PC/SC-Lite error text: ' + errorText);
    } catch (error) {
      console.log(error);
    }
  }

  /**
   * This function is executed when the PC/SC-Lite client API context is disposed
   * (either because it failed to initialize or because it was disposed later due
   * to some error).
   *
   * The GoogleSmartCard.PcscLiteClient.API that was supplied to the work function
   * also becomes disposed at this point (if not disposed yet).
   */
  function stopWork() {
    //
    // CHANGE HERE:
    // Place your custom deinitialization code here:
    //
  }

  initializeContext();

  GSC.AppUtils.enableSelfAutoLoading();

  GSC.BackgroundPageUnloadPreventing.enable();

}); // goog.scope
