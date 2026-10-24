/**
 * @file test/test_circuit_measurements_merge.test.js
 * @brief Vitest testing suite validating circuit measurements sample-and-hold merge and deduplication.
 */

'use strict';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
require('./test_config');

const db = require('../lib/db');

describe('Circuit Measurements Sample-and-Hold & Merge', () => {
    const testHomeId = 987654;
    const testCircuit = 1;
    let pool;

    beforeAll(async () => {
        pool = db.getPool();
        // Clean up any stale test rows
        await pool.execute('DELETE FROM circuit_measurements WHERE home_id = ?', [testHomeId]);
        await pool.execute('DELETE FROM heating_circuits WHERE home_id = ?', [testHomeId]);
        await pool.execute('DELETE FROM heating_systems WHERE home_id = ?', [testHomeId]);

        // Insert baseline circuit & system
        await pool.execute(
            'INSERT INTO heating_circuits (home_id, number, field_4000, field_4040, field_4080, field_2090, field_2040) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [testHomeId, testCircuit, 20.0, 19.5, 0, 1, 55.0]
        );
        await pool.execute(
            'INSERT INTO heating_systems (home_id, boiler_present, field_044c, field_044d, field_0450, field_0452, field_0457, field_0460) VALUES (?, 1, ?, ?, ?, ?, ?, ?)',
            [testHomeId, 40.0, 35.0, 45.0, 20, 1, 1500]
        );
    });

    afterAll(async () => {
        await pool.execute('DELETE FROM circuit_measurements WHERE home_id = ?', [testHomeId]);
        await pool.execute('DELETE FROM heating_circuits WHERE home_id = ?', [testHomeId]);
        await pool.execute('DELETE FROM heating_systems WHERE home_id = ?', [testHomeId]);
    });

    it('merges circuit telemetry and HVAC telemetry across successive calls without nulling fields', async () => {
        // Step 1: Incoming circuit telemetry frame only
        await db.insertCircuitMeasurement(testHomeId, testCircuit, { '0x4000': 21.5, '0x4040': 20.8, '0x4080': 75 }, {});

        let [rows] = await pool.execute(
            'SELECT * FROM circuit_measurements WHERE home_id = ? AND circuit_number = ? ORDER BY id DESC LIMIT 1',
            [testHomeId, testCircuit]
        );
        expect(rows.length).toBe(1);
        expect(Number(rows[0].field_4000)).toBe(21.5);
        expect(Number(rows[0].field_4040)).toBe(20.8);
        expect(Number(rows[0].field_4080)).toBe(75);
        // Baseline HVAC values from heating_systems should be populated
        expect(Number(rows[0].field_044c)).toBe(40.0);
        expect(Number(rows[0].field_044d)).toBe(35.0);

        // Step 2: Incoming HVAC telemetry frame with extended FIDs (exhaust temp, DHW temp, flow rate)
        // Wait at least 20ms to allow distinct timestamp or change
        await new Promise(r => setTimeout(r, 50));
        await db.insertCircuitMeasurement(testHomeId, testCircuit, {}, {
            '0x044c': 48.2,
            '0x044d': 41.0,
            '0x044e': 68.4,
            '0x045a': 55.0,
            '0x045e': 4.2,
            '0x0452': 80
        });

        [rows] = await pool.execute(
            'SELECT * FROM circuit_measurements WHERE home_id = ? AND circuit_number = ? ORDER BY id DESC LIMIT 1',
            [testHomeId, testCircuit]
        );
        expect(rows.length).toBe(1);
        // Should retain prior circuit metrics
        expect(Number(rows[0].field_4000)).toBe(21.5);
        expect(Number(rows[0].field_4040)).toBe(20.8);
        expect(Number(rows[0].field_4080)).toBe(75);
        // And have updated HVAC metrics
        expect(Number(rows[0].field_044c)).toBe(48.2);
        expect(Number(rows[0].field_044d)).toBe(41.0);
        expect(Number(rows[0].field_044e)).toBe(68.4);
        expect(Number(rows[0].field_045a)).toBe(55.0);
        expect(Number(rows[0].field_045e)).toBe(4.2);
        expect(Number(rows[0].field_0452)).toBe(80);

        // Step 3: Incoming circuit update only
        await new Promise(r => setTimeout(r, 50));
        await db.insertCircuitMeasurement(testHomeId, testCircuit, { '0x4080': 30 }, {});

        [rows] = await pool.execute(
            'SELECT * FROM circuit_measurements WHERE home_id = ? AND circuit_number = ? ORDER BY id DESC LIMIT 1',
            [testHomeId, testCircuit]
        );
        expect(Number(rows[0].field_4080)).toBe(30);
        // Target and ref remain preserved from prior
        expect(Number(rows[0].field_4000)).toBe(21.5);
        expect(Number(rows[0].field_4040)).toBe(20.8);
        // Extended HVAC metrics remain preserved from prior
        expect(Number(rows[0].field_044c)).toBe(48.2);
        expect(Number(rows[0].field_044e)).toBe(68.4);
        expect(Number(rows[0].field_045a)).toBe(55.0);
        expect(Number(rows[0].field_045e)).toBe(4.2);
    });

    it('deduplicates identical consecutive circuit measurement inserts within 15 seconds', async () => {
        const [beforeCount] = await pool.execute(
            'SELECT COUNT(*) as cnt FROM circuit_measurements WHERE home_id = ? AND circuit_number = ?',
            [testHomeId, testCircuit]
        );

        // Re-send identical measurement immediately
        await db.insertCircuitMeasurement(testHomeId, testCircuit, {}, {});

        const [afterCount] = await pool.execute(
            'SELECT COUNT(*) as cnt FROM circuit_measurements WHERE home_id = ? AND circuit_number = ?',
            [testHomeId, testCircuit]
        );
        expect(afterCount[0].cnt).toBe(beforeCount[0].cnt);
    });

    it('persists extended HVAC FIDs directly to heating_systems columns in upsertHeatingSystem', async () => {
        await db.upsertHeatingSystem(testHomeId, {
            '0x044e': 72.1,
            '0x045a': 58.5,
            '0x045e': 5.0,
            '0x0462': 1.8
        });

        const [hsRows] = await pool.execute(
            'SELECT field_044e, field_045a, field_045e, field_0462 FROM heating_systems WHERE home_id = ?',
            [testHomeId]
        );
        expect(hsRows.length).toBe(1);
        expect(Number(hsRows[0].field_044e)).toBe(72.1);
        expect(Number(hsRows[0].field_045a)).toBe(58.5);
        expect(Number(hsRows[0].field_045e)).toBe(5.0);
        expect(Number(hsRows[0].field_0462)).toBe(1.8);
    });
});
