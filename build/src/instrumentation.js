"use strict";
/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PinoInstrumentation = void 0;
const api_1 = require("@opentelemetry/api");
const instrumentation_1 = require("@opentelemetry/instrumentation");
const version_1 = require("./version");
const pinoVersions = ['>=5.14.0 <9'];
class PinoInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super('@opentelemetry/instrumentation-pino', version_1.VERSION, config);
    }
    init() {
        return [
            new instrumentation_1.InstrumentationNodeModuleDefinition('pino', pinoVersions, (pinoModule, moduleVersion) => {
                api_1.diag.debug(`Applying patch for pino@${moduleVersion}`);
                const instrumentation = this;
                const patchedPino = Object.assign((...args) => {
                    if (args.length == 0) {
                        return pinoModule({
                            mixin: instrumentation._getMixinFunction(),
                        });
                    }
                    if (args.length == 1) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const optsOrStream = args[0];
                        if (typeof optsOrStream === 'string' ||
                            typeof (optsOrStream === null || optsOrStream === void 0 ? void 0 : optsOrStream.write) === 'function') {
                            args.splice(0, 0, {
                                mixin: instrumentation._getMixinFunction(),
                            });
                            return pinoModule(...args);
                        }
                    }
                    args[0] = instrumentation._combineOptions(args[0]);
                    try {
                        return pinoModule(...args);
                    }
                    catch (_a) {
                        return pinoModule.default(...args);
                    }
                }, pinoModule);
                if (typeof patchedPino.pino === 'function') {
                    patchedPino.pino = patchedPino;
                }
                if (typeof patchedPino.default === 'function') {
                    patchedPino.default = patchedPino;
                }
                return patchedPino;
            }),
        ];
    }
    getConfig() {
        return this._config;
    }
    setConfig(config) {
        this._config = config;
    }
    _callHook(span, record, level) {
        const hook = this.getConfig().logHook;
        if (!hook) {
            return;
        }
        instrumentation_1.safeExecuteInTheMiddle(() => hook(span, record, level), err => {
            if (err) {
                api_1.diag.error('pino instrumentation: error calling logHook', err);
            }
        }, true);
    }
    _getMixinFunction() {
        const instrumentation = this;
        return function otelMixin(_context, level) {
            if (!instrumentation.isEnabled()) {
                return {};
            }
            const span = api_1.trace.getSpan(api_1.context.active());
            if (!span) {
                return {};
            }
            const spanContext = span.spanContext();
            if (!api_1.isSpanContextValid(spanContext)) {
                return {};
            }
            const record = {
                trace_id: spanContext.traceId,
                span_id: spanContext.spanId,
                trace_flags: `0${spanContext.traceFlags.toString(16)}`,
            };
            instrumentation._callHook(span, record, level);
            return record;
        };
    }
    _combineOptions(options) {
        if (options === undefined) {
            return { mixin: this._getMixinFunction() };
        }
        if (options.mixin === undefined) {
            options.mixin = this._getMixinFunction();
            return options;
        }
        const originalMixin = options.mixin;
        const otelMixin = this._getMixinFunction();
        options.mixin = (context, level) => {
            return Object.assign(otelMixin(context, level), originalMixin(context, level));
        };
        return options;
    }
}
exports.PinoInstrumentation = PinoInstrumentation;
//# sourceMappingURL=instrumentation.js.map