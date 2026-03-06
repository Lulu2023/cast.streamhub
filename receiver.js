/* global cast */
const castDebugLogger = cast.debug.CastDebugLogger.getInstance();
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

const TAG = 'StreamHub';

// ── Activer le debug overlay sur la TV ───────────────────────────────────────
context.addEventListener(cast.framework.system.EventType.READY, () => {
  if (!castDebugLogger.debugOverlayElement_) {
    castDebugLogger.setEnabled(true);
    castDebugLogger.showDebugLogs(true);
  }
  // Log les événements player core (BUFFERING, PLAYING, ERROR, etc.)
  castDebugLogger.loggerLevelByEvents = {
    'cast.framework.events.category.CORE': cast.framework.LoggerLevel.INFO,
    'cast.framework.events.EventType.MEDIA_STATUS': cast.framework.LoggerLevel.DEBUG,
  };
});

// ── Intercepteur LOAD ────────────────────────────────────────────────────────
playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const media = loadRequestData.media || {};
    const customData = media.customData || {};
    const drm = customData.drm || {};

    // Log tout ce qui arrive pour diagnostic
    castDebugLogger.info(TAG, '--- LOAD reçu ---');
    castDebugLogger.info(TAG, 'contentId: ' + media.contentId);
    castDebugLogger.info(TAG, 'contentType: ' + media.contentType);
    castDebugLogger.info(TAG, 'streamType: ' + media.streamType);
    castDebugLogger.info(TAG, 'customData: ' + JSON.stringify(customData));
    castDebugLogger.info(TAG, 'drm.licenseUrl: ' + (drm.licenseUrl || 'AUCUN'));
    castDebugLogger.info(TAG, 'drm.headers: ' + JSON.stringify(drm.headers || {}));

    if (drm.licenseUrl) {
      castDebugLogger.info(TAG, 'DRM Widevine activé');

      playerManager.setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
        playbackConfig.licenseUrl = drm.licenseUrl;
        playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;

        const headers = drm.headers || {};
        if (Object.keys(headers).length > 0) {
          castDebugLogger.info(TAG, 'Injection headers DRM: ' + Object.keys(headers).join(', '));
          playbackConfig.licenseRequestHandler = (requestInfo) => {
            requestInfo.headers = Object.assign({}, requestInfo.headers || {}, headers);
          };
        } else {
          castDebugLogger.warn(TAG, 'Aucun header DRM trouvé !');
        }

        return playbackConfig;
      });
    } else {
      castDebugLogger.warn(TAG, 'Pas de DRM — lecture sans licence Widevine');
      playerManager.setMediaPlaybackInfoHandler(null);
    }

    return loadRequestData;
  }
);

// ── Log les erreurs player ────────────────────────────────────────────────────
playerManager.addEventListener(
  cast.framework.events.EventType.ERROR,
  (event) => {
    castDebugLogger.error(TAG, 'Erreur player: ' + JSON.stringify(event));
  }
);

// ── Démarrage ─────────────────────────────────────────────────────────────────
context.start({
  useIdleTimeout: true,
  maxInactivity: 900,
});
