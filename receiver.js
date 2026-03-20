/* global cast */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

/**
 * Transforme une réponse DRMtoday JSON en ArrayBuffer binaire Widevine.
 * DRMtoday retourne : { "status": "OK", "license": "<base64>" }
 * Shaka/CAF attend des bytes binaires directement.
 */
function parseDrmtodayResponse(rawBuffer) {
  try {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(rawBuffer));
    if (!text.trimStart().startsWith('{')) return rawBuffer; // déjà binaire
    const json = JSON.parse(text);
    if (json.status !== 'OK' || !json.license) {
      console.error('[Receiver] DRMtoday error:', json.status, json.message || '');
      return rawBuffer;
    }
    const raw = atob(json.license);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  } catch (e) {
    console.warn('[Receiver] DRMtoday parse failed, using raw response:', e);
    return rawBuffer;
  }
}

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    const customData = loadRequestData.media?.customData || {};
    const drm = customData?.drm || {};

    if (drm.licenseUrl) {
      playerManager.setMediaPlaybackInfoHandler((loadRequest, playbackConfig) => {
        playbackConfig.licenseUrl = drm.licenseUrl;
        playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;

        const headers = drm.headers || {};
        const isDrmtoday = drm.provider === 'drmtoday';

        if (isDrmtoday) {
          // DRMtoday : injecter les headers ET transformer la réponse JSON → binaire
          playbackConfig.licenseRequestHandler = (requestInfo) => {
            requestInfo.headers = Object.assign({}, requestInfo.headers || {}, headers);
          };

          // licenseHandler remplace complètement l'acquisition de licence.
          // On fait le fetch manuellement pour pouvoir parser la réponse JSON.
          playbackConfig.licenseHandler = (drmRequest) => {
            return fetch(drm.licenseUrl, {
              method: 'POST',
              headers: Object.assign(
                { 'Content-Type': 'application/octet-stream' },
                headers
              ),
              body: drmRequest.body,
            })
              .then((res) => res.arrayBuffer())
              .then((buf) => parseDrmtodayResponse(buf));
          };
        } else {
          // Standard (RTBF, TF1) : injecter les headers uniquement
          if (Object.keys(headers).length > 0) {
            playbackConfig.licenseRequestHandler = (requestInfo) => {
              requestInfo.headers = Object.assign({}, requestInfo.headers || {}, headers);
            };
          }
        }

        return playbackConfig;
      });
    } else {
      playerManager.setMediaPlaybackInfoHandler(null);
    }

    return loadRequestData;
  }
);

context.start({
  useIdleTimeout: true,
  maxInactivity: 900,
});
