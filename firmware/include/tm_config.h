#pragma once
// Timing & local-safety configuration (demonstration values, not certified safety limits).
#define TM_TELEMETRY_MS          2000   // normal sampling → evidence period
#define TM_TELEMETRY_CHALLENGE_MS 1000  // faster while a custody challenge is active
#define TM_POLL_MS_DEFAULT       1500
#define TM_HTTP_TIMEOUT_MS       4000
#define TM_LINK_LOSS_MS          15000  // no authenticated server response → pump safe-off
#define TM_PUMP_MAX_MS           30000  // hard cap per command
#define TM_BUFFER_SLOTS          24     // bounded RAM buffer of signed envelopes (oldest dropped + counted)
#define TM_MQ135_WARMUP_MS       120000
#define TM_PIR_WARMUP_MS         60000
#define TM_PROBE_CRIT_C          60.0f  // local interlock (mirrors backend policy default)
#define TM_FLAME_DEBOUNCE        3      // consecutive 50 ms samples
#define TM_IR_ACTIVE_LOW         1
#define TM_FLAME_ACTIVE_LOW      1
#define TM_RELAY_ACTIVE_LOW      1      // VERIFY your module; wrong polarity energises the pump at boot
#define TM_SERVO_OPEN_DEG        90     // verify end stops for your actual MG995/MG996R before mounting
#define TM_SERVO_CLOSED_DEG      0
#define TM_SD_LOG_MIN_MS         10000  // controlled flash/SD write rate
