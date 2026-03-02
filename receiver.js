/* global cast, shaka */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

let lastLicenseHeaders = null;

function applyDrmConfig(customData) {
  const drm = customData?.drm || {};
  if (!drm.licenseUrl) return;

  const config = {
    drm: {
      servers: {
        'com.widevine.alpha': drm.licenseUrl,
      },
    },
  };

  playerManager.setPlayerConfig(config);

  try {
    const player = playerManager.getPlayer();
    const headers = drm.headers || {};
    if (player && headers && JSON.stringify(headers) !== JSON.stringify(lastLicenseHeaders)) {
      lastLicenseHeaders = headers;
      const net = player.getNetworkingEngine();
      if (net) {
        net.registerRequestFilter((type, request) => {
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            request.headers = Object.assign({}, request.headers || {}, headers);
          }
        });
      }
    }
  } catch (e) {
    console.error('DRM config error', e);
  }
}

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const customData = loadRequestData.media?.customData || {};
    applyDrmConfig(customData);
    return loadRequestData;
  }
);

context.start({
  useIdleTimeout: true,
  maxInactivity: 900,
});
