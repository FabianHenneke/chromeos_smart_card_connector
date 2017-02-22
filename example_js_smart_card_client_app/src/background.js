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

  /**
   * This function is executed when the context for using PC/SC-Lite client API is
   * initialized successfully.
   * @param {!GSC.PcscLiteClient.API} api Object that allows to perform PC/SC-Lite
   * client API requests.
   */
  async function work(api) {
    //
    // CHANGE HERE:
    // Place your custom code working with PC/SC-Lite client API here:
    //
    console.log('Establishing context...');
    try {
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
