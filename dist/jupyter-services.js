"use strict";
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
var jupyter;
(function (jupyter) {
    var services;
    (function (services) {
        var serialize;
        (function (serialize_1) {
            /**
             * Deserialize and return the unpacked message.
             */
            function deserialize(data) {
                var value;
                if (typeof data === "string") {
                    value = JSON.parse(data);
                }
                else {
                    value = deserializeBinary(data);
                }
                return value;
            }
            serialize_1.deserialize = deserialize;
            /**
             * Serialize a kernel message for transport.
             */
            function serialize(msg) {
                var value;
                if (msg.buffers && msg.buffers.length) {
                    value = serializeBinary(msg);
                }
                else {
                    value = JSON.stringify(msg);
                }
                return value;
            }
            serialize_1.serialize = serialize;
            /**
             * Deserialize a binary message to a Kernel Message.
             */
            function deserializeBinary(buf) {
                var data = new DataView(buf);
                // read the header: 1 + nbufs 32b integers
                var nbufs = data.getUint32(0);
                var offsets = [];
                if (nbufs < 2) {
                    throw new Error("Invalid incoming Kernel Message");
                }
                for (var i = 1; i <= nbufs; i++) {
                    offsets.push(data.getUint32(i * 4));
                }
                var json_bytes = new Uint8Array(buf.slice(offsets[0], offsets[1]));
                var msg = JSON.parse((new TextDecoder('utf8')).decode(json_bytes));
                // the remaining chunks are stored as DataViews in msg.buffers
                msg.buffers = [];
                for (var i = 1; i < nbufs; i++) {
                    var start = offsets[i];
                    var stop = offsets[i + 1] || buf.byteLength;
                    msg.buffers.push(new DataView(buf.slice(start, stop)));
                }
                return msg;
            }
            /**
             * Implement the binary serialization protocol.
             * Serialize Kernel message to ArrayBuffer.
             */
            function serializeBinary(msg) {
                var offsets = [];
                var buffers = [];
                var encoder = new TextEncoder('utf8');
                var json_utf8 = encoder.encode(JSON.stringify(msg, replace_buffers));
                buffers.push(json_utf8.buffer);
                for (var i = 0; i < msg.buffers.length; i++) {
                    // msg.buffers elements could be either views or ArrayBuffers
                    // buffers elements are ArrayBuffers
                    var b = msg.buffers[i];
                    buffers.push(b instanceof ArrayBuffer ? b : b.buffer);
                }
                var nbufs = buffers.length;
                offsets.push(4 * (nbufs + 1));
                for (i = 0; i + 1 < buffers.length; i++) {
                    offsets.push(offsets[offsets.length - 1] + buffers[i].byteLength);
                }
                var msg_buf = new Uint8Array(offsets[offsets.length - 1] + buffers[buffers.length - 1].byteLength);
                // use DataView.setUint32 for network byte-order
                var view = new DataView(msg_buf.buffer);
                // write nbufs to first 4 bytes
                view.setUint32(0, nbufs);
                // write offsets to next 4 * nbufs bytes
                for (i = 0; i < offsets.length; i++) {
                    view.setUint32(4 * (i + 1), offsets[i]);
                }
                // write all the buffers at their respective offsets
                for (i = 0; i < buffers.length; i++) {
                    msg_buf.set(new Uint8Array(buffers[i]), offsets[i]);
                }
                return msg_buf.buffer;
            }
            /**
             * Filter "buffers" key for JSON.stringify
             */
            function replace_buffers(key, value) {
                if (key === "buffers") {
                    return undefined;
                }
                return value;
            }
        })(serialize = services.serialize || (services.serialize = {}));
    })(services = jupyter.services || (jupyter.services = {}));
})(jupyter || (jupyter = {})); // module jupyter.services

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") return Reflect.decorate(decorators, target, key, desc);
    switch (arguments.length) {
        case 2: return decorators.reduceRight(function(o, d) { return (d && d(o)) || o; }, target);
        case 3: return decorators.reduceRight(function(o, d) { return (d && d(target, key)), void 0; }, void 0);
        case 4: return decorators.reduceRight(function(o, d) { return (d && d(target, key, o)) || o; }, desc);
    }
};
var jupyter;
(function (jupyter) {
    var services;
    (function (services) {
        var signal = phosphor.core.signal;
        var Disposable = phosphor.utility.Disposable;
        /**
         * The url for the kernel service.
         */
        var KERNEL_SERVICE_URL = 'api/kernel';
        /**
         * Get a logger kernel objects.
         */
        var kernel_log = Logger.get('kernel');
        /**
         * A class to communicate with the Python kernel. This
         * should generally not be constructed directly, but be created
         * by the `Session` object. Once created, this object should be
         * used to communicate with the kernel.
         */
        var Kernel = (function () {
            /**
             * Construct a new kernel.
             */
            function Kernel(baseUrl, wsUrl) {
                this._id = '';
                this._name = '';
                this._baseUrl = '';
                this._kernelUrl = '';
                this._wsUrl = '';
                this._username = '';
                this._staticId = '';
                this._ws = null;
                this._infoReply = null;
                this._reconnectLimit = 7;
                this._autorestartAttempt = 0;
                this._reconnectAttempt = 0;
                this._handlerMap = null;
                this._iopubHandlers = null;
                this._status = '';
                this._status = 'unknown';
                this._baseUrl = baseUrl;
                this._wsUrl = wsUrl;
                if (!this._wsUrl) {
                    // trailing 's' in https will become wss for secure web sockets
                    this._wsUrl = location.protocol.replace('http', 'ws') + "//" + location.host;
                }
                this._staticId = services.utils.uuid();
                this._handlerMap = new Map();
                if (typeof WebSocket === 'undefined') {
                    alert('Your browser does not have WebSocket support, please try Chrome, Safari, or Firefox ≥ 11.');
                }
            }
            /**
             * GET /api/kernels
             *
             * Get the list of running kernels.
             */
            Kernel.list = function (baseUrl) {
                var kernelServiceUrl = services.utils.urlJoinEncode(baseUrl, KERNEL_SERVICE_URL);
                return services.utils.ajaxRequest(kernelServiceUrl, {
                    method: "GET",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status === 200) {
                        if (!Array.isArray(success.data)) {
                            throw Error('Invalid kernel list');
                        }
                        for (var i = 0; i < success.data.length; i++) {
                            validateKernelId(success.data[i]);
                        }
                        return success.data;
                    }
                    throw Error('Invalid Status: ' + success.xhr.status);
                });
            };
            Object.defineProperty(Kernel.prototype, "name", {
                /**
                 * Get the name of the kernel.
                 */
                get: function () {
                    return this._name;
                },
                /**
                 * Set the name of the kernel.
                 */
                set: function (value) {
                    this._name = value;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "isConnected", {
                /**
                 * Check whether there is a connection to the kernel. This
                 * function only returns true if websocket has been
                 * created and has a state of WebSocket.OPEN.
                 */
                get: function () {
                    if (this._ws === null) {
                        return false;
                    }
                    if (this._ws.readyState !== WebSocket.OPEN) {
                        return false;
                    }
                    return true;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "isFullyDisconnected", {
                /**
                 * Check whether the connection to the kernel has been completely
                 * severed. This function only returns true if the websocket is null.
                 */
                get: function () {
                    return (this._ws === null);
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "infoReply", {
                /**
                 * Get the Info Reply Message from the kernel.
                 */
                get: function () {
                    return this._infoReply;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "status", {
                /**
                 * Get the current status of the kernel.
                 */
                get: function () {
                    return this._status;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "id", {
                /**
                 * Get the current id of the kernel.
                 */
                get: function () {
                    return this._id;
                },
                /**
                 * Set the current id of the kernel.
                 */
                set: function (value) {
                    this._id = value;
                    this._kernelUrl = services.utils.urlJoinEncode(this._baseUrl, KERNEL_SERVICE_URL, this._id);
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(Kernel.prototype, "wsUrl", {
                /**
                 * Get the full websocket url.
                 */
                get: function () {
                    return [
                        this._wsUrl,
                        services.utils.urlJoinEncode(this._kernelUrl, 'channels'),
                        "?session_id=" + this._staticId
                    ].join('');
                },
                enumerable: true,
                configurable: true
            });
            /**
             * GET /api/kernels/[:kernel_id]
             *
             * Get information about the kernel.
             */
            Kernel.prototype.getInfo = function () {
                var _this = this;
                return services.utils.ajaxRequest(this._kernelUrl, {
                    method: "GET",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid Status: ' + success.xhr.status);
                    }
                    validateKernelId(success.data);
                    return success.data;
                }, function (error) {
                    _this._onError(error);
                });
            };
            /**
             * POST /api/kernels/[:kernel_id]/interrupt
             *
             * Interrupt the kernel.
             */
            Kernel.prototype.interrupt = function () {
                var _this = this;
                this._handleStatus('interrupting');
                var url = services.utils.urlJoinEncode(this._kernelUrl, 'interrupt');
                return services.utils.ajaxRequest(url, {
                    method: "POST",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 204) {
                        throw Error('Invalid Status: ' + success.xhr.status);
                    }
                }, function (error) {
                    _this._onError(error);
                });
            };
            /**
             * POST /api/kernels/[:kernel_id]/restart
             *
             * Restart the kernel.
             */
            Kernel.prototype.restart = function () {
                var _this = this;
                this._handleStatus('restarting');
                this.disconnect();
                var url = services.utils.urlJoinEncode(this._kernelUrl, 'restart');
                return services.utils.ajaxRequest(url, {
                    method: "POST",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid Status: ' + success.xhr.status);
                    }
                    validateKernelId(success.data);
                    _this.connect();
                    return success.data;
                }, function (error) {
                    _this._onError(error);
                });
            };
            /**
             * POST /api/kernels/[:kernel_id]
             *
             * Start a kernel.  Note: if using a session, Session.start()
             * should be used instead.
             */
            Kernel.prototype.start = function (id) {
                var _this = this;
                if (id !== void 0) {
                    this.id = id.id;
                    this.name = id.name;
                }
                if (!this._kernelUrl) {
                    throw Error('You must set the kernel id before starting.');
                }
                this._handleStatus('starting');
                return services.utils.ajaxRequest(this._kernelUrl, {
                    method: "POST",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid Status: ' + success.xhr.status);
                    }
                    validateKernelId(success.data);
                    _this.connect(success.data);
                    return success.data;
                }, function (error) {
                    _this._onError(error);
                });
            };
            /**
             * DELETE /api/kernels/[:kernel_id]
             *
             * Shut down a kernel. Note: if useing a session, Session.shutdown()
             * should be used instead.
             */
            Kernel.prototype.shutdown = function () {
                this._handleStatus('shutdown');
                this.disconnect();
                return services.utils.ajaxRequest(this._kernelUrl, {
                    method: "DELETE",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 204) {
                        throw Error('Invalid response');
                    }
                });
            };
            /**
             * Connect to the server-side the kernel.
             *
             * This should only be called directly by a session.
             */
            Kernel.prototype.connect = function (id) {
                if (id !== void 0) {
                    this.id = id.id;
                    this.name = id.name;
                }
                if (!this._kernelUrl) {
                    throw Error('You must set the kernel id before starting');
                }
                this._startChannels();
                this._handleStatus('created');
            };
            /**
             * Reconnect to a disconnected kernel. This is not actually a
             * standard HTTP request, but useful function nonetheless for
             * reconnecting to the kernel if the connection is somehow lost.
             */
            Kernel.prototype.reconnect = function () {
                if (this.isConnected) {
                    return;
                }
                this._reconnectAttempt = this._reconnectAttempt + 1;
                this._handleStatus('reconnecting');
                this._startChannels();
            };
            /**
             * Disconnect the kernel.
             */
            Kernel.prototype.disconnect = function () {
                var _this = this;
                if (this._ws !== null) {
                    if (this._ws.readyState === WebSocket.OPEN) {
                        console.log('disconnect');
                        this._ws.onclose = function () { _this._clearSocket(); };
                        this._ws.close();
                    }
                    else {
                        console.log('straight clearsocket');
                        this._clearSocket();
                    }
                }
            };
            /**
             * Send a message on the kernel's shell channel.
             */
            Kernel.prototype.sendShellMessage = function (msg_type, content, metadata, buffers) {
                var _this = this;
                if (metadata === void 0) { metadata = {}; }
                if (buffers === void 0) { buffers = []; }
                if (!this.isConnected) {
                    throw new Error("kernel is not connected");
                }
                var msg = this._createMsg(msg_type, content, metadata, buffers);
                msg.channel = 'shell';
                this._ws.send(services.serialize.serialize(msg));
                var future = new KernelFutureHandler(function () {
                    _this._handlerMap.delete(msg.header.msgId);
                });
                this._handlerMap.set(msg.header.msgId, future);
                return future;
            };
            /**
             * Get kernel info.
             *
             * Returns a KernelFuture that will resolve to a `kernel_info_reply` message documented
             * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#kernel-info)
             */
            Kernel.prototype.kernelInfo = function () {
                return this.sendShellMessage("kernel_info_request", {});
            };
            /**
             * Get info on an object.
             *
             * Returns a KernelFuture that will resolve to a `inspect_reply` message documented
             * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#object-information)
             */
            Kernel.prototype.inspect = function (code, cursor_pos) {
                var content = {
                    code: code,
                    cursor_pos: cursor_pos,
                    detail_level: 0
                };
                return this.sendShellMessage("inspect_request", content);
            };
            /**
             * Execute given code into kernel, returning a KernelFuture.
             *
             * @example
             *
             * The options object should contain the options for the execute
             * call. Its default values are:
             *
             *      options = {
             *        silent : true,
             *        user_expressions : {},
             *        allow_stdin : false,
                      store_history: false
             *      }
             *
             */
            Kernel.prototype.execute = function (code, options) {
                var content = {
                    code: code,
                    silent: true,
                    store_history: false,
                    user_expressions: {},
                    allow_stdin: false
                };
                services.utils.extend(content, options);
                return this.sendShellMessage("execute_request", content);
            };
            /**
             * Request a code completion from the kernel.
             *
             * Returns a KernelFuture with will resolve to a `complete_reply` documented
             * [here](http://ipython.org/ipython-doc/dev/development/messaging.html#complete)
             */
            Kernel.prototype.complete = function (code, cursor_pos) {
                var content = {
                    code: code,
                    cursor_pos: cursor_pos
                };
                return this.sendShellMessage("complete_request", content);
            };
            /**
             * Send an input reply message to the kernel.
             *
             * TODO: how to handle this?  Right now called by
             * ./static/notebook/js/outputarea.js:827:
             * this.events.trigger('send_input_reply.Kernel', value);
             *
             * which has no reference to the session or the kernel
             */
            Kernel.prototype.sendInputReply = function (input) {
                if (!this.isConnected) {
                    throw new Error("kernel is not connected");
                }
                var content = {
                    value: input
                };
                var msg = this._createMsg("input_reply", content);
                msg.channel = 'stdin';
                this._ws.send(services.serialize.serialize(msg));
                return msg.header.msgId;
            };
            /**
             * Create a kernel message given input attributes.
             */
            Kernel.prototype._createMsg = function (msg_type, content, metadata, buffers) {
                if (metadata === void 0) { metadata = {}; }
                if (buffers === void 0) { buffers = []; }
                var msg = {
                    header: {
                        msgId: services.utils.uuid(),
                        username: this._username,
                        session: this._staticId,
                        msgType: msg_type,
                        version: "5.0"
                    },
                    metadata: metadata || {},
                    content: content,
                    buffers: buffers || [],
                    parentHeader: {}
                };
                return msg;
            };
            /**
             * Handle a kernel status change message.
             */
            Kernel.prototype._handleStatus = function (status) {
                this.statusChanged.emit(status);
                this._status = status;
                var msg = 'Kernel: ' + status + ' (' + this._id + ')';
                if (status === 'idle' || status === 'busy') {
                    kernel_log.debug(msg);
                }
                else {
                    kernel_log.info(msg);
                }
            };
            /**
             * Handle a failed AJAX request by logging the error message, and throwing
             * another error.
             */
            Kernel.prototype._onError = function (error) {
                var msg = "API request failed (" + error.statusText + "): ";
                kernel_log.error(msg);
                throw Error(error.statusText);
            };
            /**
             * Start the Websocket channels.
             * Will stop and restart them if they already exist.
             */
            Kernel.prototype._startChannels = function () {
                var _this = this;
                this.disconnect();
                var ws_host_url = this._wsUrl + this._kernelUrl;
                kernel_log.info("Starting WebSockets:", ws_host_url);
                this._ws = new WebSocket(this.wsUrl);
                // Ensure incoming binary messages are not Blobs
                this._ws.binaryType = 'arraybuffer';
                var already_called_onclose = false; // only alert once
                this._ws.onclose = function (evt) {
                    if (already_called_onclose) {
                        return;
                    }
                    already_called_onclose = true;
                    if (!evt.wasClean) {
                        // If the websocket was closed early, that could mean
                        // that the kernel is actually dead. Try getting
                        // information about the kernel from the API call --
                        // if that fails, then assume the kernel is dead,
                        // otherwise just follow the typical websocket closed
                        // protocol.
                        _this.getInfo().then(function () {
                            this._ws_closed(ws_host_url, false);
                        }, function () {
                            this._kernel_dead();
                        });
                    }
                };
                this._ws.onerror = function (evt) {
                    if (already_called_onclose) {
                        return;
                    }
                    already_called_onclose = true;
                    _this._wsClosed(ws_host_url, true);
                };
                this._ws.onopen = function (evt) {
                    _this._wsOpened(evt);
                };
                var ws_closed_late = function (evt) {
                    if (already_called_onclose) {
                        return;
                    }
                    already_called_onclose = true;
                    if (!evt.wasClean) {
                        _this._wsClosed(ws_host_url, false);
                    }
                };
                // switch from early-close to late-close message after 1s
                setTimeout(function () {
                    if (_this._ws !== null) {
                        _this._ws.onclose = ws_closed_late;
                    }
                }, 1000);
                this._ws.onmessage = function (evt) {
                    _this._handleWSMessage(evt);
                };
            };
            /**
             * Clear the websocket if necessary.
             */
            Kernel.prototype._clearSocket = function () {
                console.log('_clearSocket');
                if (this._ws && this._ws.readyState === WebSocket.CLOSED) {
                    this._ws = null;
                }
                this._handleStatus('disconnected');
            };
            /**
             * Perform necessary tasks once the connection to the kernel has
             * been established. This includes requesting information about
             * the kernel.
             */
            Kernel.prototype._kernelConnected = function () {
                var _this = this;
                this._handleStatus('connected');
                this._reconnectAttempt = 0;
                // get kernel info so we know what state the kernel is in
                this.kernelInfo().onReply(function (reply) {
                    _this._infoReply = reply.content;
                    _this._handleStatus('ready');
                    _this._autorestartAttempt = 0;
                });
            };
            /**
             * Perform necessary tasks after the kernel has died. This closes
             * communication channels to the kernel if they are still somehow
             * open.
             */
            Kernel.prototype._kernelDead = function () {
                this._handleStatus('dead');
                this.disconnect();
            };
            /**
             * Handle a websocket entering the open state,
             * signaling that the kernel is connected when websocket is open.
             */
            Kernel.prototype._wsOpened = function (evt) {
                if (this.isConnected) {
                    // all events ready, trigger started event.
                    this._kernelConnected();
                }
            };
            /**
             * Handle a websocket entering the closed state.  If the websocket
             * was not closed due to an error, try to reconnect to the kernel.
             *
             * @param {string} ws_url - the websocket url
             * @param {bool} error - whether the connection was closed due to an error
             */
            Kernel.prototype._wsClosed = function (ws_url, error) {
                this.disconnect();
                this._handleStatus('disconnected');
                if (error) {
                    kernel_log.error('WebSocket connection failed: ', ws_url);
                    this._handleStatus('connectionFailed');
                }
                this._scheduleReconnect();
            };
            /**
             * Function to call when kernel connection is lost.
             * schedules reconnect, or fires 'connection_dead' if reconnect limit is hit.
             */
            Kernel.prototype._scheduleReconnect = function () {
                var _this = this;
                if (this._reconnectAttempt < this._reconnectLimit) {
                    var timeout = Math.pow(2, this._reconnectAttempt);
                    kernel_log.error("Connection lost, reconnecting in " + timeout + " seconds.");
                    setTimeout(function () { _this.reconnect(); }, 1e3 * timeout);
                }
                else {
                    this._handleStatus('connectionDead');
                    kernel_log.error("Failed to reconnect, giving up.");
                }
            };
            /**
             * Handle an incoming Websocket message.
             */
            Kernel.prototype._handleWSMessage = function (e) {
                try {
                    var msg = services.serialize.deserialize(e.data);
                }
                catch (error) {
                    kernel_log.error(error.message);
                    return;
                }
                if (msg.channel === 'iopub' && msg.msgType === 'status') {
                    this._handleStatusMessage(msg);
                }
                if (msg.parentHeader) {
                    var header = msg.parentHeader;
                    var future = this._handlerMap.get(header.msgId);
                    if (future) {
                        future.handleMsg(msg);
                    }
                }
            };
            /**
             * Handle status iopub messages from the kernel.
             */
            Kernel.prototype._handleStatusMessage = function (msg) {
                var _this = this;
                var execution_state = msg.content.execution_state;
                if (execution_state !== 'dead') {
                    this._handleStatus(execution_state);
                }
                if (execution_state === 'starting') {
                    this.kernelInfo().onReply(function (reply) {
                        _this._infoReply = reply.content;
                        _this._handleStatus('ready');
                        _this._autorestartAttempt = 0;
                    });
                }
                else if (execution_state === 'restarting') {
                    // autorestarting is distinct from restarting,
                    // in that it means the kernel died and the server is restarting it.
                    // kernel_restarting sets the notification widget,
                    // autorestart shows the more prominent dialog.
                    this._autorestartAttempt = this._autorestartAttempt + 1;
                    this._handleStatus('autorestarting');
                }
                else if (execution_state === 'dead') {
                    this._kernelDead();
                }
            };
            __decorate([
                signal
            ], Kernel.prototype, "statusChanged");
            return Kernel;
        })();
        services.Kernel = Kernel;
        /**
         * Bit flags for the kernel future state.
         */
        var KernelFutureFlag;
        (function (KernelFutureFlag) {
            KernelFutureFlag[KernelFutureFlag["GotReply"] = 1] = "GotReply";
            KernelFutureFlag[KernelFutureFlag["GotIdle"] = 2] = "GotIdle";
            KernelFutureFlag[KernelFutureFlag["AutoDispose"] = 4] = "AutoDispose";
            KernelFutureFlag[KernelFutureFlag["IsDone"] = 8] = "IsDone";
        })(KernelFutureFlag || (KernelFutureFlag = {}));
        /**
         * Implementation of a kernel future.
         */
        var KernelFutureHandler = (function (_super) {
            __extends(KernelFutureHandler, _super);
            function KernelFutureHandler() {
                _super.apply(this, arguments);
                this._status = 0;
                this._input = null;
                this._output = null;
                this._reply = null;
                this._done = null;
            }
            Object.defineProperty(KernelFutureHandler.prototype, "autoDispose", {
                /**
                 * Get the current autoDispose status of the future.
                 */
                get: function () {
                    return this._testFlag(KernelFutureFlag.AutoDispose);
                },
                /**
                 * Set the current autoDispose behavior of the future.
                 *
                 * If True, it will self-dispose() after onDone() is called.
                 */
                set: function (value) {
                    if (value) {
                        this._setFlag(KernelFutureFlag.AutoDispose);
                    }
                    else {
                        this._clearFlag(KernelFutureFlag.AutoDispose);
                    }
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(KernelFutureHandler.prototype, "isDone", {
                /**
                 * Check for message done state.
                 */
                get: function () {
                    return this._testFlag(KernelFutureFlag.IsDone);
                },
                enumerable: true,
                configurable: true
            });
            /**
             * Register a reply handler. Returns `this`.
             */
            KernelFutureHandler.prototype.onReply = function (cb) {
                this._reply = cb;
                return this;
            };
            /**
             * Register an output handler. Returns `this`.
             */
            KernelFutureHandler.prototype.onOutput = function (cb) {
                this._output = cb;
                return this;
            };
            /**
             * Register a done handler. Returns `this`.
             */
            KernelFutureHandler.prototype.onDone = function (cb) {
                this._done = cb;
                return this;
            };
            /**
             * Register an input handler. Returns `this`.
             */
            KernelFutureHandler.prototype.onInput = function (cb) {
                this._input = cb;
                return this;
            };
            /**
             * Handle an incoming message from the kernel belonging to this future.
             */
            KernelFutureHandler.prototype.handleMsg = function (msg) {
                if (msg.channel === 'iopub') {
                    var output = this._output;
                    if (output)
                        output(msg);
                    if (msg.msgType === 'status' && msg.content.execution_state === 'idle') {
                        this._setFlag(KernelFutureFlag.GotIdle);
                        if (this._testFlag(KernelFutureFlag.GotReply)) {
                            this._handleDone(msg);
                        }
                    }
                }
                else if (msg.channel === 'shell') {
                    var reply = this._output;
                    if (reply)
                        reply(msg);
                    this._setFlag(KernelFutureFlag.GotReply);
                    if (this._testFlag(KernelFutureFlag.GotIdle)) {
                        this._handleDone(msg);
                    }
                }
                else if (msg.channel === 'stdin') {
                    var input = this._input;
                    if (input)
                        input(msg);
                }
            };
            /**
             * Dispose and unregister the future.
             */
            KernelFutureHandler.prototype.dispose = function () {
                this._input = null;
                this._output = null;
                this._reply = null;
                this._done = null;
                _super.prototype.dispose.call(this);
            };
            /**
             * Handle a message done status.
             */
            KernelFutureHandler.prototype._handleDone = function (msg) {
                this._setFlag(KernelFutureFlag.IsDone);
                var done = this._done;
                if (done)
                    done(msg);
                // clear the other callbacks
                this._reply = null;
                this._done = null;
                this._input = null;
                if (this._testFlag(KernelFutureFlag.AutoDispose)) {
                    this.dispose();
                }
            };
            /**
             * Test whether the given future flag is set.
             */
            KernelFutureHandler.prototype._testFlag = function (flag) {
                return (this._status & flag) !== 0;
            };
            /**
             * Set the given future flag.
             */
            KernelFutureHandler.prototype._setFlag = function (flag) {
                this._status |= flag;
            };
            /**
             * Clear the given future flag.
             */
            KernelFutureHandler.prototype._clearFlag = function (flag) {
                this._status &= ~flag;
            };
            return KernelFutureHandler;
        })(Disposable);
        /**
         * Validate an object as being of IKernelID type
         */
        function validateKernelId(info) {
            if (!info.hasOwnProperty('name') || !info.hasOwnProperty('id')) {
                throw Error('Invalid kernel id');
            }
            if ((typeof info.id !== 'string') || (typeof info.name !== 'string')) {
                throw Error('Invalid kernel id');
            }
        }
        services.validateKernelId = validateKernelId;
    })(services = jupyter.services || (jupyter.services = {}));
})(jupyter || (jupyter = {})); // module jupyter.services

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") return Reflect.decorate(decorators, target, key, desc);
    switch (arguments.length) {
        case 2: return decorators.reduceRight(function(o, d) { return (d && d(o)) || o; }, target);
        case 3: return decorators.reduceRight(function(o, d) { return (d && d(target, key)), void 0; }, void 0);
        case 4: return decorators.reduceRight(function(o, d) { return (d && d(target, key, o)) || o; }, desc);
    }
};
var jupyter;
(function (jupyter) {
    var services;
    (function (services) {
        var signal = phosphor.core.signal;
        /**
         * The url for the session service.
         */
        var SESSION_SERVICE_URL = 'api/sessions';
        /**
         * Get a logger session objects.
         */
        var session_log = Logger.get('session');
        ;
        ;
        ;
        /**
         * Session object for accessing the session REST api. The session
         * should be used to start kernels and then shut them down -- for
         * all other operations, the kernel object should be used.
         **/
        var NotebookSession = (function () {
            /**
             * Construct a new session.
             */
            function NotebookSession(options) {
                this._id = "unknown";
                this._notebookPath = "unknown";
                this._baseUrl = "unknown";
                this._sessionUrl = "unknown";
                this._wsUrl = "unknown";
                this._kernel = null;
                this._id = services.utils.uuid();
                this._notebookPath = options.notebookPath;
                this._baseUrl = options.baseUrl;
                this._wsUrl = options.wsUrl;
                this._kernel = new services.Kernel(this._baseUrl, this._wsUrl);
                this._sessionUrl = services.utils.urlJoinEncode(this._baseUrl, SESSION_SERVICE_URL, this._id);
            }
            /**
             * GET /api/sessions
             *
             * Get a list of the current sessions.
             */
            NotebookSession.list = function (baseUrl) {
                var sessionUrl = services.utils.urlJoinEncode(baseUrl, SESSION_SERVICE_URL);
                return services.utils.ajaxRequest(sessionUrl, {
                    method: "GET",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid Status: ' + success.xhr.status);
                    }
                    if (!Array.isArray(success.data)) {
                        throw Error('Invalid Session list');
                    }
                    for (var i = 0; i < success.data.length; i++) {
                        validateSessionId(success.data[i]);
                    }
                    return success.data;
                });
            };
            Object.defineProperty(NotebookSession.prototype, "kernel", {
                /**
                 * Get the session kernel object.
                */
                get: function () {
                    return this._kernel;
                },
                enumerable: true,
                configurable: true
            });
            /**
             * POST /api/sessions
             *
             * Start a new session. This function can only be successfully executed once.
             */
            NotebookSession.prototype.start = function () {
                var _this = this;
                var url = services.utils.urlJoinEncode(this._baseUrl, SESSION_SERVICE_URL);
                return services.utils.ajaxRequest(url, {
                    method: "POST",
                    dataType: "json",
                    data: JSON.stringify(this._model),
                    contentType: 'application/json'
                }).then(function (success) {
                    if (success.xhr.status !== 201) {
                        throw Error('Invalid response');
                    }
                    validateSessionId(success.data);
                    _this._kernel.connect(success.data.kernel);
                    _this._handleStatus('kernelCreated');
                    return success.data;
                }, function (error) {
                    _this._handleStatus('kernelDead');
                });
            };
            /**
             * GET /api/sessions/[:session_id]
             *
             * Get information about a session.
             */
            NotebookSession.prototype.getInfo = function () {
                return services.utils.ajaxRequest(this._sessionUrl, {
                    method: "GET",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid response');
                    }
                    validateSessionId(success.data);
                    return success.data;
                });
            };
            /**
             * DELETE /api/sessions/[:session_id]
             *
             * Kill the kernel and shutdown the session.
             */
            NotebookSession.prototype.delete = function () {
                if (this._kernel) {
                    this._handleStatus('kernelKilled');
                    this._kernel.disconnect();
                }
                return services.utils.ajaxRequest(this._sessionUrl, {
                    method: "DELETE",
                    dataType: "json"
                }).then(function (success) {
                    if (success.xhr.status !== 204) {
                        throw Error('Invalid response');
                    }
                    validateSessionId(success.data);
                }, function (rejected) {
                    if (rejected.xhr.status === 410) {
                        throw Error('The kernel was deleted but the session was not');
                    }
                    throw Error(rejected.statusText);
                });
            };
            /**
             * Restart the session by deleting it and then starting it fresh.
             */
            NotebookSession.prototype.restart = function (options) {
                var _this = this;
                return this.delete().then(function () { return _this.start(); }).catch(function () { return _this.start(); }).then(function () {
                    if (options && options.notebookPath) {
                        _this._notebookPath = options.notebookPath;
                    }
                    if (options && options.kernelName) {
                        _this._kernel.name = options.kernelName;
                    }
                });
            };
            /**
             * Rename the notebook.
             */
            NotebookSession.prototype.renameNotebook = function (path) {
                this._notebookPath = path;
                return services.utils.ajaxRequest(this._sessionUrl, {
                    method: "PATCH",
                    dataType: "json",
                    data: JSON.stringify(this._model),
                    contentType: 'application/json'
                }).then(function (success) {
                    if (success.xhr.status !== 200) {
                        throw Error('Invalid response');
                    }
                    validateSessionId(success.data);
                    return success.data;
                });
            };
            Object.defineProperty(NotebookSession.prototype, "_model", {
                /**
                 * Get the data model for the session, which includes the notebook path
                 * and kernel (name and id).
                 */
                get: function () {
                    return {
                        id: this._id,
                        notebook: { path: this._notebookPath },
                        kernel: { name: this._kernel.name,
                            id: this._kernel.id }
                    };
                },
                enumerable: true,
                configurable: true
            });
            /**
             * Handle a session status change.
             */
            NotebookSession.prototype._handleStatus = function (status) {
                this.statusChanged.emit(status);
                session_log.error('Session: ' + status + ' (' + this._id + ')');
            };
            __decorate([
                signal
            ], NotebookSession.prototype, "statusChanged");
            return NotebookSession;
        })();
        services.NotebookSession = NotebookSession;
        /**
         * Validate an object as being of ISessionId type.
         */
        function validateSessionId(info) {
            if (!info.hasOwnProperty('id') || !info.hasOwnProperty('notebook') ||
                !info.hasOwnProperty('kernel')) {
                throw Error('Invalid Session Model');
            }
            services.validateKernelId(info.kernel);
            if (typeof info.id !== 'string') {
                throw Error('Invalid Session Model');
            }
            validateNotebookId(info.notebook);
        }
        /**
         * Validate an object as being of INotebookId type.
         */
        function validateNotebookId(model) {
            if ((!model.hasOwnProperty('path')) || (typeof model.path !== 'string')) {
                throw Error('Invalid Notebook Model');
            }
        }
    })(services = jupyter.services || (jupyter.services = {}));
})(jupyter || (jupyter = {})); // module jupyter.services

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
var jupyter;
(function (jupyter) {
    var services;
    (function (services) {
        var utils;
        (function (utils) {
            /**
             * Copy the contents of one object to another, recursively.
             *
             * http://stackoverflow.com/questions/12317003/something-like-jquery-extend-but-standalone
             */
            function extend(target, source) {
                target = target || {};
                for (var prop in source) {
                    if (typeof source[prop] === 'object') {
                        target[prop] = extend(target[prop], source[prop]);
                    }
                    else {
                        target[prop] = source[prop];
                    }
                }
                return target;
            }
            utils.extend = extend;
            /**
             * Get a uuid as a string.
             *
             * http://www.ietf.org/rfc/rfc4122.txt
             */
            function uuid() {
                var s = [];
                var hexDigits = "0123456789ABCDEF";
                for (var i = 0; i < 32; i++) {
                    s[i] = hexDigits.charAt(Math.floor(Math.random() * 0x10));
                }
                s[12] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
                s[16] = hexDigits.charAt((Number(s[16]) & 0x3) | 0x8); // bits 6-7 of the clock_seq_hi_and_reserved to 01
                return s.join("");
            }
            utils.uuid = uuid;
            /**
             * Join a sequence of url components with '/'.
             */
            function urlPathJoin() {
                var paths = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    paths[_i - 0] = arguments[_i];
                }
                var url = '';
                for (var i = 0; i < paths.length; i++) {
                    if (paths[i] === '') {
                        continue;
                    }
                    if (url.length > 0 && url.charAt(url.length - 1) != '/') {
                        url = url + '/' + paths[i];
                    }
                    else {
                        url = url + paths[i];
                    }
                }
                return url.replace(/\/\/+/, '/');
            }
            utils.urlPathJoin = urlPathJoin;
            /**
             * Encode just the components of a multi-segment uri,
             * leaving '/' separators.
             */
            function encodeURIComponents(uri) {
                return uri.split('/').map(encodeURIComponent).join('/');
            }
            utils.encodeURIComponents = encodeURIComponents;
            /**
             * Join a sequence of url components with '/',
             * encoding each component with encodeURIComponent.
             */
            function urlJoinEncode() {
                var args = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    args[_i - 0] = arguments[_i];
                }
                return encodeURIComponents(urlPathJoin.apply(null, args));
            }
            utils.urlJoinEncode = urlJoinEncode;
            /**
             * Properly detect the current browser.
             * http://stackoverflow.com/questions/2400935/browser-detection-in-javascript
             */
            utils.browser = (function () {
                if (typeof navigator === 'undefined') {
                    // navigator undefined in node
                    return ['None'];
                }
                var N = navigator.appName;
                var ua = navigator.userAgent;
                var tem;
                var M = ua.match(/(opera|chrome|safari|firefox|msie)\/?\s*(\.?\d+(\.\d+)*)/i);
                if (M && (tem = ua.match(/version\/([\.\d]+)/i)) !== null)
                    M[2] = tem[1];
                M = M ? [M[1], M[2]] : [N, navigator.appVersion, '-?'];
                return M;
            })();
            /**
             * Return a serialized object string suitable for a query.
             *
             * http://stackoverflow.com/a/30707423
             */
            function jsonToQueryString(json) {
                return '?' +
                    Object.keys(json).map(function (key) {
                        return encodeURIComponent(key) + '=' +
                            encodeURIComponent(json[key]);
                    }).join('&');
            }
            utils.jsonToQueryString = jsonToQueryString;
            /**
             * Asynchronous XMLHTTPRequest handler.
             *
             * http://www.html5rocks.com/en/tutorials/es6/promises/#toc-promisifying-xmlhttprequest
             */
            function ajaxRequest(url, settings) {
                return new Promise(function (resolve, reject) {
                    var req = new XMLHttpRequest();
                    req.open(settings.method, url);
                    if (settings.contentType) {
                        req.overrideMimeType(settings.contentType);
                    }
                    req.onload = function () {
                        var response = req.response;
                        if (settings.dataType === 'json') {
                            response = JSON.parse(req.response);
                        }
                        resolve({ data: response, statusText: req.statusText, xhr: req });
                    };
                    req.onerror = function (err) {
                        reject({ xhr: req, statusText: req.statusText, error: err });
                    };
                    if (settings.data) {
                        req.send(settings.data);
                    }
                    else {
                        req.send();
                    }
                });
            }
            utils.ajaxRequest = ajaxRequest;
        })(utils = services.utils || (services.utils = {}));
    })(services = jupyter.services || (jupyter.services = {}));
})(jupyter || (jupyter = {})); // module jupyter.services 
