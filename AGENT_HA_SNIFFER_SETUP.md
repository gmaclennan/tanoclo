# Agent task: turn the Tado RF sniffer data into a useful Home Assistant setup

You have Home Assistant MCP access. The user runs Home Assistant in Docker (the "Container" install, so no app store) on a QNAP NAS. A passive Tado radio sniffer (an ESP32 board plus the TaNoClo stream receiver container) is already publishing to MQTT with Home Assistant discovery, but nothing has been done in Home Assistant yet.

**Background you need:**
- **The house:** Tado V3+ radiator valves, plus a Tado Extension Kit that switches the radiator-loop pump on and off. About 30% of radiators have no Tado valve and are always open.
- **The heat pump:** Samsung EHS Mono R290 16 kW, which heats a buffer tank on a weather compensation curve. Home Assistant has **no control of it yet**; a Modbus link (MIM-B19N) may be added later.
- **The goal for now:** observe and understand the system, so the weather compensation curve and pump strategy can be tuned. Later it will drive the heat pump's flow temperature from room demand.

## Ground rules

- **Read-only towards the heating system.** Don't create anything that switches heating, changes Tado setpoints or calls Tado services. This phase is monitoring, helpers, recording and dashboards only.
- **Use native Home Assistant constructs.** Prefer helpers (`min_max`, binary sensor `group`, `history_stats`, `statistics`) over template sensors. Use `entity_id`, never `device_id`, in automations. Use `numeric_state` and `state` triggers and conditions rather than template ones.
- **Discover, don't assume.** Entity IDs are generated from device and entity names, so look them up through MCP rather than constructing them.
- **Stop and ask the user** at each **ASK USER** point, and before renaming anything.
- If your MCP tools can't create a particular helper, dashboard or automation, produce the exact YAML (or UI steps) for the user instead, and say so.
- Don't touch the existing official Tado integration if one is configured, except to read from it.

## Step 1: inventory what the sniffer created

1. List MQTT devices and entities. The sniffer creates:
   - **`TaNoClo RF Sniffer Receiver`**: packet counters (Total Packets Received, Bad CRC, Decryption Failures, Decoded CoAP Packets, Active PANs). Unique IDs start with `tanoclo_sniffer_receiver_`.
   - **`Sniffed VA02 (VA…)`** (valves) and possibly `Sniffed RU… (RU…)` (room thermostat or Extension Kit) and `Sniffed IB… (IB…)` (bridge). Per valve, the useful entities are:
     - Temperature
     - Target Temperature
     - **Heat Demand** (%)
     - Valve Position (%)
     - Raw Steps
     - **Zone Call for Heat** (binary)
     - Battery Level / Battery Voltage / Battery Low
     - Signal Strength (RSSI)
     - Humidity, if reported
   - **`Sniffed Heating Circuit N`**: Heat Demand (%), **Call for Heat**, Heating Active, Pump Active, Target / Reference Temperature, Operating Mode.
   - Devices named by MAC address (`tado/sniffer/m/<mac>/…`) instead of by serial: these haven't been identified yet. Note them, but don't build on them.
2. Report a table: device, serial, entity IDs, current state, last-changed time. Flag any entity that is `unknown` or `unavailable`, or hasn't updated in more than 2 hours.
3. Check the receiver counters. Decoded CoAP packets should be increasing, and decryption failures should be small relative to the total. If not, stop and report: the RF key or radio channel is wrong, and that has to be fixed outside Home Assistant.

## Step 2: map valves to rooms

1. If the official Tado integration is installed, read its devices. Their device info usually includes serial numbers (VA…/RU…). Match these to the sniffed serials and propose a room for each.
2. Otherwise, **ASK USER** for the serial → room mapping. The serial is printed on each valve and visible in the Tado app under Settings → Rooms & Devices.
3. **ASK USER** to approve the proposed mapping, then:
   - Assign each sniffed device to its room **area** (create areas if missing).
   - Rename each sniffed **device** to something like `Living Room Valve (sniffed)`.
   - Nothing references these entities yet, so it's safe now to rename entity IDs to a consistent scheme, e.g. `sensor.living_room_valve_heat_demand`, `sensor.living_room_valve_position`, `binary_sensor.living_room_valve_call_for_heat`. **ASK USER** before doing this, and do it before creating anything in steps 3–5. If they decline, keep the generated IDs and use those throughout.
4. **ASK USER** which rooms have always-open radiators with no Tado valve. Record them as a list; they matter in step 5.

## Step 3: helpers

Create these as UI helpers where your tools allow, otherwise output YAML. Use the room entity IDs from step 2.

1. **`sensor.heating_max_valve_demand`**: `min_max`, type `max`, over every valve's Heat Demand. This is the key tuning signal: the neediest room.
2. **`sensor.heating_mean_valve_demand`**: `min_max`, type `mean`, over the same entities.
3. **`sensor.heating_max_valve_position`**: `min_max`, type `max`, over every Valve Position (%) entity, if those report sensible values.
4. **`binary_sensor.any_room_calling_for_heat`**: binary sensor **group** (any-on) over every Zone Call for Heat entity that actually reports.
5. **Daily run-time and start counts** (`history_stats`), using the circuit's **Call for Heat** if it reports, otherwise `binary_sensor.any_room_calling_for_heat`:
   - `sensor.heating_call_hours_today`: type `time`, state `on`, from midnight today to now
   - `sensor.heating_call_starts_today`: type `count`, state `on`, same period. A high count means short cycling, the main thing to reduce.
6. **Per-room hours at high demand** (optional, good for spotting undersized radiators): for each room, a `history_stats` of time today with Heat Demand above 80%. This needs a threshold binary sensor first: use the `threshold` helper (upper 80, hysteresis 5) on each room's Heat Demand, then `history_stats` on that.

Don't create template sensors for any of the above.

## Step 4: recording and history

1. Confirm the numeric sniffer sensors have `state_class: measurement`, which the sniffer sets by discovery, so they appear in long-term statistics. Report any that don't.
2. If the recorder has a short `purge_keep_days` or exclude filters, tell the user. Ideally keep at least 30 days of raw history for these entities while tuning. Don't change recorder config yourself; **ASK USER** and give the YAML.

## Step 5: dashboard

Create a dashboard called **"Heating"**. If you can't create dashboards through MCP, output the YAML.

1. **Overview row:**
   - `sensor.heating_max_valve_demand`, `sensor.heating_mean_valve_demand`
   - `binary_sensor.any_room_calling_for_heat`
   - `sensor.heating_call_hours_today`, `sensor.heating_call_starts_today`
   - the circuit Heat Demand and Call for Heat, if present
   - outdoor temperature, from the user's weather integration if they have one
2. **Per-room cards**, grouped by area: temperature, target, Heat Demand, Valve Position, battery.
3. **History graph (last 24 h):** every room's Heat Demand on one graph, plus `binary_sensor.any_room_calling_for_heat`.
4. **Statistics graph (last 7 days, hourly mean):** each room's Heat Demand and temperature.
5. **Diagnostics section:** receiver packet counters, per-valve RSSI and battery.

## Step 6: watchdog and notifications (alerts only, no control)

**ASK USER** which notify service to use (e.g. a `notify.mobile_app_…` entity), then create:

1. **Sniffer data stale.**
   - Trigger: `state` on the receiver's Decoded CoAP Packets sensor, with `for: "00:30:00"` and no `to`/`from`. This fires when the value hasn't changed for 30 minutes.
   - Action: notify "Tado sniffer: no data for 30 min".
   - Mode `single`.
2. **Valve battery low.**
   - Trigger: `state` on all valve Battery Low binary sensors, `to: "on"`, `for: "01:00:00"`.
   - Action: notify naming the room, using the trigger's entity name.
   - Mode `parallel`.
3. **Short cycling** (optional).
   - Trigger: `numeric_state` on `sensor.heating_call_starts_today`, `above` a value the user chooses (suggest 12).
   - Action: notify once.
   - Mode `single`.

## Step 7: validate the data before anyone relies on it

Run these checks after 24 hours of data and report the findings:

1. **Heat Demand is right.** The sniffer publishes 0% when a valve's regular radio update omits the demand value. That's based on protocol notes, not confirmed.
   - If the official Tado integration is present, compare each room's sniffed Heat Demand with Tado's "heating power" sensor over the same period. Report the correlation and any rooms that disagree.
   - Without it, **ASK USER** to compare a few readings against the Tado app.
2. **Update frequency.** For each valve, the typical interval between Heat Demand / Temperature updates. Flag valves with gaps over 30 minutes; they're probably at the edge of the sniffer's radio range.
3. **Call for Heat matches reality.** **ASK USER** whether the radiator-loop pump is actually running when Call for Heat is on. A smart plug, or the pump's own indicator, would confirm it.

## Final report to the user

Summarise:
- the device → room mapping, and any renames done
- helpers, dashboard and automations created, with entity IDs
- the step 7 validation results and any untrustworthy sensors
- anything you produced as YAML for the user to apply manually
- the suggested next tuning step. Typically:
  1. Run the radiator pump continuously for a few days and compare `sensor.heating_call_starts_today` and comfort.
  2. Then lower the weather compensation curve 1 °C at a time while watching `sensor.heating_max_valve_demand` and the coldest room's temperature.
