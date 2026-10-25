# Agent task: set up a LILYGO TTGO LoRa32 as a Tado RF sniffer (macOS)

You are running on the user's MacBook, which has a LILYGO TTGO LoRa32 V1.6.1 (868 MHz, SX1276) plugged in over USB. Your job is to flash it with ESPHome, use it to retrieve the Tado RF network key, reflash it as a passive sniffer, and prepare the files the user needs to run the receiver on their QNAP NAS.

Work step by step. Several steps need the user to do something physical or give you information. Stop and ask at each **ASK USER** point; never guess these values.

## Ground rules

- **Antenna first.** Before the board is powered with the pairing firmware, confirm with the user that the 868 MHz antenna is screwed on. The pairing firmware transmits, and transmitting without an antenna can damage the radio. **ASK USER** to confirm.
- **Secrets.** WiFi credentials, the OTA password and the retrieved RF key are secrets. Keep them in `secrets.yaml` / the output folder with `chmod 600`. Don't commit or push them anywhere, and don't paste them into anything except the files named here.
- **Don't push or modify the git repository's remote.** Local edits only.
- **Use non-interactive commands.** `esphome run` prompts for a port if you don't give one, so always pass `--device`. Use `--no-logs` when flashing, and read logs separately with a timeout.
- If something fails twice the same way, stop and report the exact error output to the user rather than improvising.

## Step 0: prerequisites

1. Check for Homebrew (`brew --version`). If it's missing, **ASK USER** whether to install it.
2. Install ESPHome:
   ```bash
   brew install pipx && pipx ensurepath && pipx install esphome
   esphome version
   ```
   (If pipx isn't wanted, `python3 -m pip install --user esphome` is an alternative.)
3. Clone the repository with the branch that has the demand sensors:
   ```bash
   mkdir -p ~/tado-sniffer && cd ~/tado-sniffer
   git clone --branch feat/sniffer-demand-call-for-heat https://github.com/gmaclennan/tanoclo.git
   ```
4. Find the board's serial port:
   ```bash
   ls /dev/cu.*
   ```
   Expect something like `/dev/cu.usbserial-XXXX` or `/dev/cu.SLAB_USBtoUART`. If nothing new appears:
   - **ASK USER** to try a different micro-USB cable. Charge-only cables are common.
   - If that doesn't help, the Silicon Labs CP210x VCP driver may be needed. **ASK USER** to install it from silabs.com and approve it under System Settings → Privacy & Security, then re-check.
   - Record the port as `$PORT`.

## Step 1: secrets

**ASK USER** for:
- WiFi SSID and password. It must be a 2.4 GHz network; the ESP32 can't join 5 GHz.

Generate a random OTA password yourself (e.g. `openssl rand -hex 16`).

Write the secrets file once and link it next to each config, since ESPHome looks for `secrets.yaml` beside the YAML file:
```bash
cd ~/tado-sniffer/tanoclo/esphome
cat > secrets.yaml <<'EOF'
wifi_ssid: "SSID_HERE"
wifi_password: "PASSWORD_HERE"
ota_password: "GENERATED_HERE"
EOF
chmod 600 secrets.yaml
ln -sf ../secrets.yaml tado_pairing/secrets.yaml
ln -sf ../secrets.yaml tado_sniffer/secrets.yaml
```
`esphome/.gitignore` and the per-project `.gitignore` files may already ignore `secrets.yaml`. Check with `git status`, and make sure it's not staged.

## Step 2: pin the component source (recommended)

Both YAML files fetch the radio component from GitHub at build time (`external_components` → `https://github.com/tanoclo/tanoclo`). To build the exact code that was reviewed, add `ref: 9fba33f` under `type: git` in both `tado_pairing/tado_pairing.yaml` and `tado_sniffer/tado_sniffer.yaml`:
```yaml
external_components:
  - source:
      type: git
      url: https://github.com/tanoclo/tanoclo
      ref: 9fba33f
      path: esphome/tado_pairing/components   # (tado_sniffer/components in the other file)
```
If the build fails because that commit can't be fetched, remove the `ref:` line, tell the user, and continue.

## Step 3: flash the pairing firmware over USB

**ASK USER** to confirm the antenna is attached (see ground rules).

```bash
cd ~/tado-sniffer/tanoclo/esphome/tado_pairing
esphome compile tado_pairing.yaml        # first build downloads the ESP32 toolchain: 10–20 min
esphome upload tado_pairing.yaml --device "$PORT"
```
If the upload can't connect, **ASK USER** to hold the board's BOOT button (if present) while you retry, or to replug the cable.

Then watch the logs for up to about 60 seconds to confirm it joined WiFi:
```bash
timeout 60 esphome logs tado_pairing.yaml --device "$PORT"
```
(`timeout` is part of GNU coreutils: `brew install coreutils` provides it as `gtimeout` if the plain command is missing.)

Note the IP address from the logs. The web page is at `http://tado-pairing.local` or `http://<IP>`. Check it responds:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://tado-pairing.local/
```

## Step 4: retrieve the RF network key

This needs the user's hands. Tell them clearly:

1. **ASK USER** to **unplug the Ethernet cable from the Tado Internet Bridge**, leaving its power connected. This is essential: if the bridge is online, the key comes back encrypted and is useless.
2. **ASK USER** to **hold the pairing button on the bridge until its pairing LED blinks.**
3. Keep the board's logs running in the background, or re-run `esphome logs` with a timeout. While the bridge is in pairing mode, the firmware should detect the bridge's MAC address and save it.
4. Press "Retrieve RF key". Either ask the user to click it at `http://tado-pairing.local`, or press it through ESPHome's web server REST API:
   ```bash
   curl -s -X POST http://tado-pairing.local/button/retrieve_rf_key/press
   ```
   If that returns 404, the URL scheme differs in this ESPHome version. Don't keep guessing; ask the user to click the button in the web page instead.
5. Watch the logs for `[Mimic] *** SUCCESS! OPERATIONAL KEY EXTRACTED! ***`. Then read the key, either from the web page's "Stored RF Key" or:
   ```bash
   curl -s http://tado-pairing.local/text_sensor/stored_rf_key
   ```
   If nothing appears within about 30 seconds, press the button again (up to 3 tries).
6. **If no bridge MAC is ever detected,** the radio channel may not be the default 26. **ASK USER** whether to try other channels. If yes, set the "Sniffer Channel" number in the web page (or `curl -s -X POST "http://tado-pairing.local/number/sniffer_channel/set?value=N"`), trying values near 26 first, and repeat from step 2 for each. Record the channel that works as `$CHANNEL`. Otherwise `$CHANNEL=26`.
7. Save the key (32 hex characters) to `~/tado-sniffer/output/rf_key.txt` with `chmod 600`.
8. **ASK USER** to **plug the bridge's Ethernet back in** and to check the Tado app shows the system online again. Don't move on until they confirm.

## Step 5: flash the sniffer firmware (over WiFi)

**ASK USER** for the **QNAP NAS's IP address**. That's where the receiver container will listen on TCP port 9999. Record it as `$NAS_IP`.

Edit `~/tado-sniffer/tanoclo/esphome/tado_sniffer/tado_sniffer.yaml`:
- `tcp_host: "192.168.0.1"` → `tcp_host: "$NAS_IP"`. Required: the sniffer has no web page to change this later.
- `channel: 26` → `channel: $CHANNEL` (only if it differs).
- `tcp_port: 9999` stays as is.

Build and flash over the air to the running pairing firmware, which accepts OTA updates with the same password:
```bash
cd ~/tado-sniffer/tanoclo/esphome/tado_sniffer
esphome compile tado_sniffer.yaml
esphome upload tado_sniffer.yaml --device tado-pairing.local   # or the board's IP
```
If OTA fails, fall back to USB: `esphome upload tado_sniffer.yaml --device "$PORT"`.

After it reboots, the device is named `tado-sniffer`. Check its logs for about 60 seconds:
```bash
timeout 60 esphome logs tado_sniffer.yaml --device tado-sniffer.local
```
Expect it to tune to the channel and to try a TCP connection to `$NAS_IP:9999`. That connection will fail until the receiver is running on the NAS (step 6), which is fine. Report what the logs show.

Tell the user the board can now move to a plain USB power supply 30 cm to 1 m from the Tado bridge, antenna upright.

## Step 6: prepare the receiver for the QNAP

Home Assistant on the NAS runs in Docker, so there's no app store. The receiver runs as its own container.

1. **ASK USER** for the MQTT broker URL that Home Assistant uses (e.g. `mqtt://192.168.1.20:1883`) and its username/password, if any. If they don't run a broker yet, tell them they need one (e.g. an `eclipse-mosquitto` container) plus Home Assistant's MQTT integration pointed at it.
2. Create `~/tado-sniffer/output/` containing:
   - a copy of `~/tado-sniffer/tanoclo/tanoclo-stream-receiver/` (exclude `node_modules` if present)
   - `docker-compose.yml`, filled in with the key and MQTT details:
   ```yaml
   services:
     tado-sniffer:
       image: node:24-slim
       working_dir: /app
       command: sh -c "npm ci --omit=dev && node stream_receiver.js --stats"
       volumes:
         - /share/Container/tado-sniffer:/app
       ports:
         - "9999:9999"
       environment:
         TADO_KEYS: "PAIRING=7461646f2070616972696e67206b6579,OPERATIONAL=<RF_KEY>"
         MQTT_ENABLED: "true"
         MQTT_HOST: "<MQTT_URL>"
         MQTT_USERNAME: "<MQTT_USER>"
         MQTT_PASSWORD: "<MQTT_PASS>"
         MQTT_TOPIC: "tado/sniffer"
         MQTT_HA_PATH: "homeassistant"
         FILE_LOGGING: "false"
       restart: unless-stopped
   ```
   `chmod 600` the compose file, since it contains the key.
3. **ASK USER** whether the NAS share is mounted on the Mac (e.g. under `/Volumes/Container`). If it is and they agree, copy `tanoclo-stream-receiver/` to the share's `tado-sniffer` folder so it lands at `/share/Container/tado-sniffer` on the NAS. Otherwise leave everything in `~/tado-sniffer/output/` and tell them to copy it over.
4. Tell the user to create the app in QNAP Container Station (Applications → Create) from `docker-compose.yml`. The volume path must match where the folder actually sits on the NAS.

## Step 7: verify end to end

Once the user has started the container:
- Container logs should show TCP data arriving from the sniffer and packets being decoded. With `--stats`, counters print every 60 seconds.
- Re-check `esphome logs tado_sniffer.yaml --device tado-sniffer.local`: the TCP connection should now succeed.
- In Home Assistant (Settings → Devices & services → MQTT), a **TaNoClo RF Sniffer Receiver** device should appear, then **Sniffed VA…** devices with Heat Demand, Temperature and Valve Position sensors, and possibly a **Sniffed Heating Circuit** device.

Troubleshooting to report back:
- **No TCP connection:** wrong `tcp_host`, port 9999 not published on the NAS, or a NAS firewall.
- **Packets arrive but most fail decryption:** wrong key in `TADO_KEYS`.
- **No packets at all:** wrong channel. Board too far from the bridge or valves.

## Final report to the user

Summarise:
- serial port used, firmware versions flashed, sniffer IP address and channel
- where the key is saved (`~/tado-sniffer/output/rf_key.txt`). Don't print the key in the summary unless the user asks.
- the contents of `~/tado-sniffer/output/` and the remaining steps for the user on the NAS
- anything that failed or was skipped
