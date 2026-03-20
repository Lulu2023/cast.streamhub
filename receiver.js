/* global cast */
const context = cast.framework.CastReceiverContext.getInstance();
const playerManager = context.getPlayerManager();

/**
 * DRMtoday retourne une réponse JSON : { "status": "OK", "license": "<base64>" }
 * CAF/Widevine attend des bytes binaires bruts.
 * licenseHandler prend la main sur tout le fetch → retourner Uint8Array.
 */
function makeDrmtodayLicenseHandler(licenseUrl, headers) {
  return function (drmRequest) {
    return fetch(licenseUrl, {
      method:  'POST',
      headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, headers),
      body:    drmRequest.body,
    })
      .then(function (res) { return res.arrayBuffer(); })
      .then(function (buf) {
        var text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        if (!text.trimStart().startsWith('{')) {
          // Déjà binaire (ne devrait pas arriver avec DRMtoday, mais sécurité)
          return new Uint8Array(buf);
        }
        var json = JSON.parse(text);
        if (json.status !== 'OK' || !json.license) {
          console.error('[Receiver] DRMtoday error:', json.status, json.message || '');
          throw new Error('DRMtoday licence refusée : ' + (json.message || json.status));
        }
        var raw   = atob(json.license);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes; // Uint8Array — requis par licenseHandler
      });
  };
}

playerManager.setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  function (loadRequestData) {
    var customData = (loadRequestData.media && loadRequestData.media.customData) || {};
    var drm        = customData.drm || {};

    if (drm.licenseUrl) {
      playerManager.setMediaPlaybackInfoHandler(function (loadRequest, playbackConfig) {
        playbackConfig.protectionSystem = cast.framework.ContentProtection.WIDEVINE;

        var headers    = drm.headers    || {};
        var isDrmtoday = drm.provider === 'drmtoday';

        if (isDrmtoday) {
          // ── RTL Play / DRMtoday ──────────────────────────────────────────────
          // licenseHandler remplace TOUT le cycle fetch+réponse.
          // NE PAS définir licenseUrl simultanément (CAF utilise l'un OU l'autre).
          playbackConfig.licenseHandler = makeDrmtodayLicenseHandler(drm.licenseUrl, headers);
          // licenseUrl doit rester vide quand licenseHandler est défini
          playbackConfig.licenseUrl = undefined;
        } else {
          // ── RTBF / TF1+ : réponse binaire standard ──────────────────────────
          // licenseRequestHandler injecte seulement les headers ; CAF gère le reste.
          playbackConfig.licenseUrl = drm.licenseUrl;
          if (Object.keys(headers).length > 0) {
            playbackConfig.licenseRequestHandler = function (requestInfo) {
              requestInfo.headers = Object.assign({}, requestInfo.headers || {}, headers);
            };
          }
        }

        return playbackConfig;
      });
    } else {
      // Pas de DRM — effacer tout handler précédent pour éviter un état résiduel
      playerManager.setMediaPlaybackInfoHandler(null);
    }

    return loadRequestData;
  }
);

context.start({
  useIdleTimeout:  true,
  maxInactivity:   900,
});
