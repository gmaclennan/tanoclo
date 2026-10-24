/**
 * @file test/test_downlink_pacing.test.js
 * @brief Vitest unit tests for downlink burst pacing queue in coap-transport.js.
 */

'use strict';
require('./test_config');
const coapTransport = require('../lib/coap-transport');
const coap = require('../lib/coap');

describe('coap-transport downlink pacing', () => {
    let sentFrames = [];
    const TEST_BRIDGE_1 = 'IB0000000001';
    const TEST_BRIDGE_2 = 'IB0000000002';
    const originalPacingMs = coapTransport.getDownlinkPacingMs();

    beforeEach(() => {
        sentFrames = [];
        coapTransport.clearBridgePacingQueue();
        coapTransport.setDownlinkPacingMs(50); // Fast pacing for unit tests

        // Initialize coap-transport with mock send function
        coapTransport.init({
            db: {},
            clients: new Map(),
            log: () => {},
            sendFn: (bridgeId, frame) => {
                sentFrames.push({ bridgeId, frame, ts: Date.now() });
            }
        });

    });

    afterEach(() => {
        coapTransport.clearBridgePacingQueue();
        coapTransport.setDownlinkPacingMs(originalPacingMs);
    });

    test('first frame sends immediately, burst frames are queued and paced', async () => {
        const coapMsg1 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x1001 });
        const coapMsg2 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_PUT, mid: 0x1002 });
        const coapMsg3 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x1003 });

        // Send 3 frames in quick succession
        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::1', 5683, coapMsg1, 'cmd1');
        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::2', 5683, coapMsg2, 'cmd2');
        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::3', 5683, coapMsg3, 'cmd3');

        // Immediately after send: exactly 1 frame dispatched, 2 frames queued
        expect(sentFrames.length).toBe(1);
        expect(sentFrames[0].bridgeId).toBe(TEST_BRIDGE_1);
        expect(coapTransport.getBridgePacingQueue(TEST_BRIDGE_1).length).toBe(2);

        // Wait for paced delivery of next frame
        await new Promise(resolve => setTimeout(resolve, 70));
        expect(sentFrames.length).toBe(2);
        expect(coapTransport.getBridgePacingQueue(TEST_BRIDGE_1).length).toBe(1);

        // Wait for final frame
        await new Promise(resolve => setTimeout(resolve, 70));
        expect(sentFrames.length).toBe(3);
        expect(coapTransport.getBridgePacingQueue(TEST_BRIDGE_1).length).toBe(0);
    });

    test('multiple bridges have isolated pacing queues', async () => {
        const coapMsg1 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x2001 });
        const coapMsg2 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x2002 });

        // First frame for Bridge 1 and Bridge 2 both send immediately
        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::1', 5683, coapMsg1, 'b1_cmd1');
        coapTransport.sendViaBridge(TEST_BRIDGE_2, null, 'fd00::10', 5683, coapMsg2, 'b2_cmd1');

        expect(sentFrames.length).toBe(2);
        const bridgeIds = sentFrames.map(f => f.bridgeId);
        expect(bridgeIds).toContain(TEST_BRIDGE_1);
        expect(bridgeIds).toContain(TEST_BRIDGE_2);
    });

    test('pacing can be disabled by setting pacing ms to 0', async () => {
        coapTransport.setDownlinkPacingMs(0);

        const coapMsg1 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x3001 });
        const coapMsg2 = coap.serialize({ type: coap.TYPE_CON, code: coap.CODE_GET, mid: 0x3002 });

        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::1', 5683, coapMsg1, 'cmd1');
        coapTransport.sendViaBridge(TEST_BRIDGE_1, null, 'fd00::2', 5683, coapMsg2, 'cmd2');

        // Both dispatched immediately
        expect(sentFrames.length).toBe(2);
        expect(coapTransport.getBridgePacingQueue(TEST_BRIDGE_1).length).toBe(0);
    });
});
