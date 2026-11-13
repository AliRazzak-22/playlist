'use strict';

// Device telemetry is unauthenticated; a valid device ID is not proof of ownership.
window.buildDatabaseRules = function buildDatabaseRules(adminUids) {
  const admin = adminUids.map((uid) => `auth.uid === '${uid}'`).join(' || ') || 'false';
  const actions = 'play|pause|next|previous|restart|reload|clear_cache|check_update|identify';
  const states = 'playing|paused|buffering|waiting|error|background|idle|stopped';

  const text = (max) => ({ '.validate': `newData.isString() && newData.val().length <= ${max}` });
  const number = { '.validate': 'newData.isNumber()' };
  const httpsUrl = {
    '.validate': "newData.isString() && newData.val().beginsWith('https://') && newData.val().length <= 2048",
  };
  const playlist = { $index: httpsUrl };
  const command = {
    '.validate': "newData.hasChildren(['id', 'action'])",
    id: text(64),
    action: { '.validate': `newData.isString() && newData.val().matches(/^(${actions})$/)` },
    ts: number,
    $other: { '.validate': false },
  };

  return {
    rules: {
      playlist: { '.read': true, '.write': admin, ...playlist },
      device_playlists: { '.read': true, '.write': admin, $device: playlist },
      commands: { '.read': true, '.write': admin, ...command },
      device_commands: { '.read': true, '.write': admin, $device: command },
      config: {
        '.read': true,
        '.write': admin,
        volume: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 1' },
        muted: { '.validate': 'newData.isBoolean()' },
        update_check_interval_minutes: {
          '.validate': 'newData.isNumber() && newData.val() >= 5 && newData.val() <= 10080',
        },
        $other: { '.validate': false },
      },
      app_version: {
        '.read': true,
        '.write': admin,
        '.validate': "newData.hasChildren(['version_code', 'apk_url'])",
        version_code: { '.validate': 'newData.isNumber() && newData.val() > 0' },
        apk_url: httpsUrl,
        sha256: { '.validate': 'newData.isString() && newData.val().length === 64 && newData.val().matches(/^[0-9a-f]+$/)' },
        $other: { '.validate': false },
      },
      device_names: {
        '.read': admin,
        '.write': admin,
        $device: text(60),
      },
      devices: {
        '.read': admin,
        $device: {
          '.write': '$device.length >= 6 && $device.length <= 64 && $device.matches(/^[A-Za-z0-9_-]+$/)',
          '.validate': "newData.hasChildren(['last_seen'])",
          model: text(100),
          android: text(100),
          version_code: number,
          version_name: text(50),
          online: { '.validate': 'newData.isBoolean()' },
          last_seen: number,
          started_at: number,
          state: { '.validate': `newData.isString() && newData.val().matches(/^(${states})$/)` },
          now_playing: text(2048),
          now_index: number,
          playlist_size: number,
          playlist_source: { '.validate': 'newData.isString() && newData.val().matches(/^(global|custom)$/)' },
          cached: number,
          free_mb: number,
          $other: { '.validate': false },
        },
      },
    },
  };
};
