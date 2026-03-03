/* global cast */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

// Shaka is loaded via the playback config; we access it through the player instance.
// We register request filters after each LOAD so headers are always fresh.

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const customData = loadRequestData.media?.customData || {};
    const drm = customData?.drm || {};

    if (drm.licenseUrl) {
      // 1. Tell the CAF which Widevine license server to use.
      playerManager.setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
        playbackConfig.licenseUrl = drm.licenseUrl;
        playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;

        // 2. Inject DRM headers (e.g. Authorization: Bearer …) on every license request.
        const headers = drm.headers || {};
        if (Object.keys(headers).length > 0) {
          playbackConfig.licenseRequestHandler = (requestInfo) => {
            requestInfo.headers = Object.assign({}, requestInfo.headers || {}, headers);
          };
        }

        return playbackConfig;
      });
    } else {
      // No DRM — clear any previously registered handler to avoid stale state.
      playerManager.setMediaPlaybackInfoHandler(null);
    }

    return loadRequestData;
  }
);

context.start({
  useIdleTimeout: true,
  maxInactivity: 900,
});
