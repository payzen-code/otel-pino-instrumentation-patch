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
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const api_1 = require("@opentelemetry/api");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const context_async_hooks_1 = require("@opentelemetry/context-async-hooks");
const stream_1 = require("stream");
const assert = require("assert");
const sinon = require("sinon");
const semver = require("semver");
const src_1 = require("../src");
const memoryExporter = new sdk_trace_base_1.InMemorySpanExporter();
const provider = new sdk_trace_node_1.NodeTracerProvider();
const tracer = provider.getTracer('default');
provider.addSpanProcessor(new sdk_trace_base_1.SimpleSpanProcessor(memoryExporter));
api_1.context.setGlobalContextManager(new context_async_hooks_1.AsyncHooksContextManager());
const kMessage = 'log-message';
describe('PinoInstrumentation', () => {
    let stream;
    let writeSpy;
    let pino;
    let instrumentation;
    let logger;
    function assertRecord(record, span) {
        const { traceId, spanId, traceFlags } = span.spanContext();
        assert.strictEqual(record['trace_id'], traceId);
        assert.strictEqual(record['span_id'], spanId);
        assert.strictEqual(record['trace_flags'], `0${traceFlags.toString(16)}`);
        assert.strictEqual(kMessage, record['msg']);
    }
    function assertInjection(span) {
        sinon.assert.calledOnce(writeSpy);
        const record = JSON.parse(writeSpy.firstCall.args[0].toString());
        assertRecord(record, span);
        return record;
    }
    function testInjection(span) {
        logger.info(kMessage);
        return assertInjection(span);
    }
    function testNoInjection() {
        logger.info(kMessage);
        sinon.assert.calledOnce(writeSpy);
        const record = JSON.parse(writeSpy.firstCall.args[0].toString());
        assert.strictEqual(record['trace_id'], undefined);
        assert.strictEqual(record['span_id'], undefined);
        assert.strictEqual(record['trace_flags'], undefined);
        assert.strictEqual(kMessage, record['msg']);
        return record;
    }
    function init(importType = 'global') {
        stream = new stream_1.Writable();
        stream._write = () => { };
        writeSpy = sinon.spy(stream, 'write');
        if (importType === 'global') {
            logger = pino(stream);
        }
        else {
            // @ts-expect-error the same function reexported
            logger = pino[importType](stream);
        }
    }
    before(() => {
        instrumentation = new src_1.PinoInstrumentation();
        instrumentation.enable();
        pino = require('pino');
    });
    describe('enabled instrumentation', () => {
        beforeEach(() => {
            init();
        });
        it('injects span context to records', () => {
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testInjection(span);
            });
        });
        it('injects span context to records in default export', function () {
            // @ts-expect-error the same function reexported
            if (!pino.default) {
                this.skip();
            }
            init('default');
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testInjection(span);
            });
        });
        it('injects span context to records in named export', function () {
            // @ts-expect-error the same function reexported
            if (!pino.pino) {
                this.skip();
            }
            init('pino');
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testInjection(span);
            });
        });
        it('injects span context to child logger records', () => {
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                const child = logger.child({ foo: 42 });
                child.info(kMessage);
                assertInjection(span);
            });
        });
        it('calls the users log hook', () => {
            const span = tracer.startSpan('abc');
            instrumentation.setConfig({
                enabled: true,
                logHook: (_span, record, level) => {
                    record['resource.service.name'] = 'test-service';
                    if (semver.satisfies(pino.version, '>= 7.9.0')) {
                        assert.strictEqual(level, 30);
                    }
                },
            });
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                const record = testInjection(span);
                assert.strictEqual(record['resource.service.name'], 'test-service');
            });
        });
        it('does not inject span context if no span is active', () => {
            assert.strictEqual(api_1.trace.getSpan(api_1.context.active()), undefined);
            testNoInjection();
        });
        it('does not inject span context if span context is invalid', () => {
            const span = api_1.trace.wrapSpanContext(api_1.INVALID_SPAN_CONTEXT);
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testNoInjection();
            });
        });
        it('does not propagate exceptions from user hooks', () => {
            const span = tracer.startSpan('abc');
            instrumentation.setConfig({
                enabled: true,
                logHook: () => {
                    throw new Error('Oops');
                },
            });
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testInjection(span);
            });
        });
    });
    describe('logger construction', () => {
        let stdoutSpy;
        beforeEach(() => {
            stream = new stream_1.Writable();
            stream._write = () => { };
            writeSpy = sinon.spy(stream, 'write');
            stdoutSpy = sinon.spy(process.stdout, 'write');
        });
        afterEach(() => {
            stdoutSpy.restore();
        });
        it('does not fail when constructing logger without arguments', () => {
            logger = pino();
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                logger.info(kMessage);
            });
            const record = JSON.parse(stdoutSpy.firstCall.args[0].toString());
            assertRecord(record, span);
        });
        it('preserves user options and adds a mixin', () => {
            logger = pino({ name: 'LogLog' }, stream);
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                const record = testInjection(span);
                assert.strictEqual(record['name'], 'LogLog');
            });
        });
        describe('binary arguments', () => {
            it('is possible to construct logger with undefined options', () => {
                logger = pino(undefined, stream);
                const span = tracer.startSpan('abc');
                api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    testInjection(span);
                });
            });
            it('preserves user mixins', () => {
                logger = pino({
                    name: 'LogLog',
                    mixin: () => ({ a: 2, b: 'bar' }),
                }, stream);
                const span = tracer.startSpan('abc');
                api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    const record = testInjection(span);
                    assert.strictEqual(record['a'], 2);
                    assert.strictEqual(record['b'], 'bar');
                    assert.strictEqual(record['name'], 'LogLog');
                });
            });
            it('ensures user mixin values take precedence', () => {
                logger = pino({
                    mixin() {
                        return { trace_id: '123' };
                    },
                }, stream);
                const span = tracer.startSpan('abc');
                api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                    logger.info(kMessage);
                });
                const record = JSON.parse(writeSpy.firstCall.args[0].toString());
                assert.strictEqual(record['trace_id'], '123');
            });
        });
    });
    describe('disabled instrumentation', () => {
        before(() => {
            instrumentation.disable();
        });
        after(() => {
            instrumentation.enable();
        });
        beforeEach(() => init());
        it('does not inject span context', () => {
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testNoInjection();
            });
        });
        it('does not call log hook', () => {
            const span = tracer.startSpan('abc');
            instrumentation.setConfig({
                enabled: false,
                logHook: (_span, record) => {
                    record['resource.service.name'] = 'test-service';
                },
            });
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                const record = testNoInjection();
                assert.strictEqual(record['resource.service.name'], undefined);
            });
        });
        it('injects span context once re-enabled', () => {
            instrumentation.enable();
            const span = tracer.startSpan('abc');
            api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => {
                testInjection(span);
            });
        });
    });
});
//# sourceMappingURL=pino.test.js.map