/**
 * @file migrations/0023_add_extended_hvac_columns.js
 * @brief Adds dedicated columns for extended HVAC telemetry FIDs to heating_systems and circuit_measurements.
 */

'use strict';

async function addColumnIfNotExists(pool, table, column, colDef) {
    const [rows] = await pool.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (rows.length === 0) {
        await pool.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${colDef}`);
        console.log(`[Migration 0023] Added column ${table}.${column}`);
    } else {
        console.log(`[Migration 0023] Column ${table}.${column} already exists.`);
    }
}

async function up(pool) {
    console.log('[Migration 0023] Adding extended HVAC telemetry columns...');

    const cols = [
        { name: 'field_044e', def: "DECIMAL(5,2) DEFAULT NULL COMMENT 'ot_exhaust_temperature'" },
        { name: 'field_045a', def: "DECIMAL(5,2) DEFAULT NULL COMMENT 'ot_dhw_temperature'" },
        { name: 'field_045e', def: "DECIMAL(5,2) DEFAULT NULL COMMENT 'ot_dhw_flow_rate'" },
        { name: 'field_044f', def: "DECIMAL(5,2) DEFAULT NULL COMMENT 'ot_outside_temperature'" },
        { name: 'field_0462', def: "DECIMAL(5,2) DEFAULT NULL COMMENT 'ot_ch_water_pressure_bar'" }
    ];

    for (const c of cols) {
        await addColumnIfNotExists(pool, 'heating_systems', c.name, c.def);
    }

    for (const c of cols) {
        await addColumnIfNotExists(pool, 'circuit_measurements', c.name, c.def);
    }

    console.log('[Migration 0023] Extended HVAC columns migration complete.');
}

async function down(pool) {
    const cols = ['field_044e', 'field_045a', 'field_045e', 'field_044f', 'field_0462'];
    for (const c of cols) {
        try {
            await pool.execute(`ALTER TABLE \`heating_systems\` DROP COLUMN \`${c}\``);
        } catch (e) {}
        try {
            await pool.execute(`ALTER TABLE \`circuit_measurements\` DROP COLUMN \`${c}\``);
        } catch (e) {}
    }
}

module.exports = { up, down };
