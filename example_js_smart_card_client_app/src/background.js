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

goog.require('goog.crypt.Sha512');


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

  async function getData(result, transmit) {
    result[1] = new Uint8Array(result[1]);
    let data = result[1].slice(0, -2);
    let returnCode = result[1].slice(-2);
    if (returnCode[0] === 0x61) {
      console.log('Data continues with ' + returnCode[1] + ' bytes.');
      let result = await getp(transmit(GET_RESPONSE_APDU));
      let dataContinued = await getData(result, transmit);
      data = concatenateUint8(data, dataContinued);
    } else if (!(returnCode[0] === 0x90 && returnCode[1] === 0x00))
      console.log('Operation returned specific status bytes:', returnCode);
    return data;
  }

  function parseDSC(data) {
    if (!(data.length === 7 && data[2] === 0x93 && data[3] === 0x03)) {
      console.log(
        'Error: Invalid response to request for digital signature counter'
      );
      return 0;
    }
    return data[6] + 0x100 * data[5] + 0x10000 * data[4];
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
    return new Uint8Array(utf8);
  }

  function uint32ToBytes(v_uint32) {
    let bytes = new Uint8Array(4);
    let view = new DataView(bytes.buffer);
    view.setUint32(0, v_uint32);
    return bytes;
  }

  function uint16ToBytes(v_uint16) {
    let bytes = new Uint8Array(2);
    let view = new DataView(bytes.buffer);
    view.setUint16(0, v_uint16);
    return bytes;
  }

  function concatenateUint8(...arrays) {
    const totalLength = arrays.reduce((total, array) => total + array.length,
      0);
    const result = new Uint8Array(totalLength);
    arrays.reduce((offset, array) => {
      result.set(array, offset);
      return offset + array.length;
    }, 0);
    return result;
  }

  // TODO: This should be replaced by proper TLV list parsing
  function extractFingerprints(applicationData) {
    let fingerprintIndex = -1;
    for (let i = 0; i < applicationData.length; i++) {
      if (applicationData[i] === 0xC5) { // Fingerprints
        if (applicationData[i + 1] === 60) { // Length: 60 bytes
          if (fingerprintIndex === -1) {
            fingerprintIndex = i + 2;
          } else {
            console.log('Error: Found multiple occurences of "0xC5 0x3C"');
          }
        }
      }
    }
    if (fingerprintIndex === -1) {
      console.log('Error: Fingerprints not found');
      return [];
    }
    return applicationData.slice(fingerprintIndex, fingerprintIndex + 60);
  }

  // Create the parts of an OpenPGP Version 4 Signature Packet for binary data
  // see: https://tools.ietf.org/html/rfc4880#section-5.2.3
  function createSignaturePackage(data, issuerBytes) {
    const PACKET_HEADER = new Uint8Array([
      0b10001001, /* ctb=89 */
      /* Bits: 1 (fixed) | 0 (old package format) | 0b0010 = 2 (signature
       * packet, tag=2) | 0b01 = 1 (two-octet length, hlen=3) */
    ]);
    const SIGNATURE_PACKET_HEADER = new Uint8Array([
      0x04, /* version number */
      0x00, /* signature type (fixed to binary) */
      0x01, /* public-key algorithm (fixed to "RSA (encrypt or sign)") */
      0x0A, /* signature algorithm (fixed to SHA512) */
    ]);
    const HASHED_SUBPACKETS_HEADER = new Uint8Array([
      0x00,
      0x06, /* length of all hashed subpackets (creation time (6 octets)) */
    ]);
    const CREATION_TIME_SUBPACKET_HEADER = new Uint8Array([
      0x05, /* length of the subpacket (type (1 octet) + time (4 octets)) */
      0x02, /* subpacket type: Signature Creation Time */
    ]);

    const time = Math.floor(Date.now() / 1000); // seconds since epoch
    const timeBytes = uint32ToBytes(time);

    const hashedPart = concatenateUint8(
      SIGNATURE_PACKET_HEADER, HASHED_SUBPACKETS_HEADER,
      CREATION_TIME_SUBPACKET_HEADER, timeBytes);
    console.log('Hashed part: ', hashedPart);

    let sha = new goog.crypt.Sha512();
    sha.update(data);
    sha.update(hashedPart);
    const hashBytes = new Uint8Array(sha.digest());
    console.log('Hash: ', hashBytes);

    const UNHASHED_SUBPACKETS_HEADER = new Uint8Array([
      0x00,
      0x0A, /* length of all unhashed subpackets (issuer (10 octets)) */
    ]);
    const ISSUER_SUBPACKET_HEADER = new Uint8Array([
      0x09, /* length of the subpacket (type (1 octet) + key id (8 octets)) */
      0x10, /* subpacket type: Issuer */
    ]);

    const unhashedPart = concatenateUint8(UNHASHED_SUBPACKETS_HEADER,
      ISSUER_SUBPACKET_HEADER, issuerBytes, hashBytes.slice(-2));
    console.log('Unhashed part: ', unhashedPart);

    const packetBody = concatenateUint8(hashedPart, unhashedPart);
    const packetHeader = concatenateUint8(PACKET_HEADER,
      uint16ToBytes(packetBody.length + 258)); // TODO: Hash size might differ
    console.log('Packed header: ', packetHeader);

    return [concatenateUint8(packetHeader, packetBody), hashBytes];
  }

  function completeSignature(packet, rawSignature) {
    let numBits = 2048;
    // Reduce number of bits by one for each leading unset bit
    // TODO: Does the length have to decrease if the first byte is 0?
    for (let i = 0; i < rawSignature.length; i++) {
      if ((rawSignature[i] & 1 << 7) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 6) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 5) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 4) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 3) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 2) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 1) !== 0)
        break;
      numBits--;
      if ((rawSignature[i] & 1 << 0) !== 0)
        break;
      numBits--;
    }
    return concatenateUint8(packet, uint16ToBytes(numBits), rawSignature);
  }

  const SELECT_FILE_APDU = new Uint8Array([0x00, 0xA4, 0x04, 0x00, 0x06,
    0xD2, 0x76, 0x00, 0x01, 0x24, 0x01, 0x00
  ]);
  const GET_DATA_CARDHOLDER_APDU = new Uint8Array([0x00, 0xCA, 0x00, 0x65,
    0x00
  ]);
  const GET_DATA_APPLICATION_RELATED_DATA_APDU = new Uint8Array([0x00, 0xCA,
    0x00, 0x6E, 0x00
  ]);
  const GET_DATA_URL_APDU = new Uint8Array([0x00, 0xCA, 0x5F, 0x50, 0x00]);
  const GET_DATA_DSC_APDU = new Uint8Array([0x00, 0xCA, 0x00, 0x7A, 0x00]);
  const VERIFY_APDU = new Uint8Array([0x00, 0x20, 0x00, 0x81]);
  const PSO_CDS_APDU = new Uint8Array([0x00, 0x2A, 0x9E, 0x9A]);
  const RSA_SHA1_DIGEST_INFO = new Uint8Array([0x30, 0x51, 0x30, 0x0D, 0x06,
    0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03, 0x05,
    0x00, 0x04, 0x40
  ]);
  const GET_RESPONSE_APDU = new Uint8Array([0x00, 0xC0, 0x00, 0x00, 0x00]);

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
      let transmit = apduBytes => api.SCardTransmit(sCardHandle, toPci(
        activeProtocol), Array.from(apduBytes));

      // Select OpenPGP applet
      let status = (await getp(transmit(SELECT_FILE_APDU)))[1];
      if (!(status[0] === 0x90 && status[1] === 0x00)) {
        console.log('Can\'t connect to OpenPGP applet.');
        return;
      }

      // Request cardholder data and public key url
      result = await getp(transmit(GET_DATA_CARDHOLDER_APDU));
      let data = await getData(result, transmit);
      console.log(bytesToString(data));
      result = await getp(transmit(GET_DATA_URL_APDU));
      data = await getData(result, transmit);
      let url = bytesToString(data);
      console.log('URL: ' + url);

      // Request application related data
      result = await getp(transmit(GET_DATA_APPLICATION_RELATED_DATA_APDU));
      data = await getData(result, transmit);
      let fingerprints = extractFingerprints(data);
      let sigKeyId = fingerprints.slice(12, 20); // get last 8 octets of sig key
      console.log('Signature Key ID: ', sigKeyId);

      // Request PIN
      let pinBytes = [];
      try {
        let pin = await SmartCardClientApp.PinDialog.Server.requestPin();
        pinBytes = utf8ToBytes(pin);
      } catch (error) {
        console.log('PIN dialog: ' + error);
        return;
      }

      // Verify PIN
      result = await getp(transmit(concatenateUint8(VERIFY_APDU, pinBytes)));
      data = await getData(result, transmit);

      // Get digital signature counter
      result = await getp(transmit(GET_DATA_DSC_APDU));
      data = await getData(result, transmit);
      console.log('DSC: ', parseDSC(data));

      // Sign
      let packageAndHash = createSignaturePackage('Hello YubiKey!',
        sigKeyId);
      let digestInfo = concatenateUint8(RSA_SHA1_DIGEST_INFO,
        packageAndHash[1]);
      let signCommand = concatenateUint8(PSO_CDS_APDU, new Uint8Array([
        digestInfo.length
      ]), digestInfo, new Uint8Array([0x00]));
      result = await getp(transmit(signCommand));
      let rawSignature = await getData(result, transmit);
      console.log('Raw signature: ', rawSignature);
      let signature = completeSignature(packageAndHash[0], rawSignature);
      console.log('Complete signature: ', signature);

      // Get digital signature counter
      result = await getp(transmit(GET_DATA_DSC_APDU));
      data = await getData(result, transmit);
      console.log('DSC: ', parseDSC(data));

      // Disconnect
      await getp(api.SCardDisconnect(sCardHandle, API.SCARD_LEAVE_CARD));
      await getp(api.SCardReleaseContext(sCardContext));

      console.log(btoa(bytesToString(signature)));
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
