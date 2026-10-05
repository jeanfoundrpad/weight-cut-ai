module.exports = function (api) {
  api.cache(true)
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // babel-preset-expo defaults hermes engines to the 'hermes-stable'
          // transform profile, which assumes the Hermes runtime natively
          // supports private class fields (#x) — true only on SDK 56+. This
          // app targets SDK 54 (see AGENTS.md — the dev's Expo Go client
          // doesn't support anything newer), whose Hermes predates that
          // support. 'hermes-v0' is the pre-SDK56 profile and includes the
          // babel transform for private fields, avoiding a runtime
          // SyntaxError inside react-native's own internals.
          unstable_transformProfile: 'hermes-v0',
        },
      ],
    ],
  }
}
