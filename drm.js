/**
 * drm.js
 * ─────────────────────────────────────────────────────────────────────────
 * Configuration DRM du PlaybackConfig CAF à partir des informations DRM
 * envoyées par le sender (licenseUrl, headers, unwrapJson...).
 *
 * Couvre notamment le cas DRMToday (RTL Play) : la licence est renvoyée
 * encapsulée en JSON  { status: "OK", license: "<base64>" }  plutôt qu'en
 * bytes binaires bruts attendus par le CDM Widevine du récepteur. C'est
 * exactement le même problème que celui résolu côté app par
 * `DrmLicenseProxy` (lib_streamhub/.../drm_license_proxy.dart) — ici on le
 * résout directement dans le receiver via `licenseRequestHandler` /
 * `licenseResponseHandler` du CAF SDK, sans avoir besoin d'un proxy HTTP
 * local (le receiver tourne déjà côté "serveur" du point de vue du CDM).
 * ─────────────────────────────────────────────────────────────────────────
 */

const StreamHubDrm = (() => {

  /**
   * Configure `playbackConfig` (un cast.framework.PlaybackConfig) avec les
   * informations DRM et headers HTTP fournies par le sender pour un média.
   *
   * @param {cast.framework.PlaybackConfig} playbackConfig
   * @param {object} media - le `media` du LOAD_VIDEO payload (voir messages.js)
   */
  function applyToPlaybackConfig(playbackConfig, media) {
    const headers = media.headers || {};
    const drm = media.drm;

    // ── Headers HTTP génériques (manifeste + segments) ──────────────────
    if (Object.keys(headers).length > 0) {
      playbackConfig.manifestRequestHandler = (requestInfo) => {
        Object.entries(headers).forEach(([key, value]) => {
          requestInfo.headers[key] = value;
        });
      };
      playbackConfig.segmentRequestHandler = (requestInfo) => {
        Object.entries(headers).forEach(([key, value]) => {
          requestInfo.headers[key] = value;
        });
      };
    }

    if (!drm || !drm.licenseUrl) {
      return; // contenu non protégé
    }

    playbackConfig.licenseUrl = drm.licenseUrl;
    playbackConfig.protectionSystem = drm.keySystem === 'playready'
      ? cast.framework.ContentProtection.PLAYREADY
      : cast.framework.ContentProtection.WIDEVINE;

    const licenseHeaders = drm.headers || {};

    // ── Requête de licence : injection des headers (token DRM, etc.) ────
    playbackConfig.licenseRequestHandler = (requestInfo) => {
      Object.entries(licenseHeaders).forEach(([key, value]) => {
        requestInfo.headers[key] = value;
      });
      requestInfo.withCredentials = false;
      return requestInfo;
    };

    // ── Réponse de licence : unwrap JSON → bytes binaires si nécessaire ──
    if (drm.unwrapJson) {
      playbackConfig.licenseResponseHandler = (response) => {
        try {
          const text = StreamHubDrm._bytesToUtf8(response.content);
          const trimmed = text.trimStart();
          if (!trimmed.startsWith('{')) {
            return response; // déjà binaire, rien à faire
          }
          const json = JSON.parse(trimmed);
          if (json.status && json.status !== 'OK') {
            cast.framework.CastReceiverContext.getInstance().log(
              'StreamHubDrm', `Réponse de licence en erreur : ${JSON.stringify(json)}`
            );
            return response;
          }
          const base64License = json.license;
          if (!base64License) {
            return response;
          }
          response.content = StreamHubDrm._base64ToBytes(base64License);
        } catch (e) {
          // Pas du JSON valide → la réponse était déjà binaire, on la
          // laisse passer telle quelle (même logique que le proxy Dart).
        }
        return response;
      };
    }
  }

  // ── Helpers bytes/base64/utf8 (le receiver n'a pas accès à `Buffer`) ──

  function _bytesToUtf8(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return new TextDecoder('utf-8').decode(view);
  }

  function _base64ToBytes(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  return {
    applyToPlaybackConfig,
    _bytesToUtf8,
    _base64ToBytes,
  };
})();

window.StreamHubDrm = StreamHubDrm;
