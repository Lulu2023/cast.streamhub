/**
 * messages.js
 * ─────────────────────────────────────────────────────────────────────────
 * Définition du protocole de communication Sender (app mobile) <-> Receiver
 * (Chromecast). Un seul namespace custom est utilisé ; chaque message porte
 * un champ `type` qui identifie son rôle.
 *
 * Ce fichier sert de DOCUMENTATION DE RÉFÉRENCE pour l'app Flutter : tous
 * les types et formes de messages utilisés par le receiver sont listés ici,
 * avec leur sens. Le receiver les importe pour éviter les chaînes magiques
 * dispersées dans le code.
 *
 * Namespace custom utilisé : urn:x-cast:com.streamhub.cast
 * (à enregistrer aussi côté Flutter, voir cast_messages.dart fourni à part)
 * ─────────────────────────────────────────────────────────────────────────
 */

const STREAMHUB_NAMESPACE = 'urn:x-cast:com.streamhub.cast';

/**
 * Types de messages envoyés par le SENDER (app Flutter) vers le RECEIVER.
 */
const SenderMessageType = Object.freeze({
  /** Charge une nouvelle vidéo. Remplace immédiatement la lecture en cours
   *  sans fermer la session de cast. Voir `LoadVideoPayload`. */
  LOAD_VIDEO: 'LOAD_VIDEO',

  /** Change la piste audio active. Voir `SetAudioTrackPayload`. */
  SET_AUDIO_TRACK: 'SET_AUDIO_TRACK',

  /** Change la piste de sous-titres (ou la désactive). Voir
   *  `SetSubtitleTrackPayload`. */
  SET_SUBTITLE_TRACK: 'SET_SUBTITLE_TRACK',

  /** Change la vitesse de lecture. Voir `SetPlaybackSpeedPayload`. */
  SET_PLAYBACK_SPEED: 'SET_PLAYBACK_SPEED',

  /** Change la qualité vidéo (Auto ou forcée). Voir `SetQualityPayload`. */
  SET_QUALITY: 'SET_QUALITY',

  /** Déclenche un "Passer l'intro" — seek vers le timestamp fourni par le
   *  sender. Voir `SkipIntroPayload`. Peut aussi être déclenché localement
   *  par la télécommande Chromecast (bouton OK) ; dans ce cas, le receiver
   *  utilise le timestamp reçu via LOAD_VIDEO (introMarker), sans nouveau
   *  message du sender. */
  SKIP_INTRO: 'SKIP_INTRO',

  /** Demande explicite de l'état complet actuel (le receiver répond avec un
   *  message STATE_UPDATE immédiat, en plus de ses envois périodiques). */
  REQUEST_STATE: 'REQUEST_STATE',
});

/**
 * Types de messages envoyés par le RECEIVER vers le(s) SENDER(s).
 */
const ReceiverMessageType = Object.freeze({
  /** Émis régulièrement (toutes les ~1s pendant la lecture) et à chaque
   *  changement d'état significatif. Voir `StateUpdatePayload`. */
  STATE_UPDATE: 'STATE_UPDATE',

  /** Émis quand une erreur survient (DRM, réseau, vidéo introuvable,
   *  licence invalide, timeout...). Voir `ErrorPayload`. */
  PLAYBACK_ERROR: 'PLAYBACK_ERROR',

  /** Émis quand le bouton "Passer l'intro" apparaît / disparaît à l'écran,
   *  pour que l'UI du sender reste synchronisée si elle affiche aussi un
   *  bouton équivalent. Voir `SkipIntroVisibilityPayload`. */
  SKIP_INTRO_VISIBILITY: 'SKIP_INTRO_VISIBILITY',

  /** Émis quand une vidéo de la queue se termine et qu'une suivante démarre
   *  automatiquement (enchaînement). Voir `VideoChangedPayload`. */
  VIDEO_CHANGED: 'VIDEO_CHANGED',
});

/**
 * ── Formes des payloads ──────────────────────────────────────────────────
 * (documentation — JS n'a pas de typage statique, ces commentaires servent
 * de contrat. Le pendant Dart typé est dans cast_messages.dart.)
 */

/**
 * LoadVideoPayload
 * {
 *   type: 'LOAD_VIDEO',
 *   media: {
 *     contentId: string,            // id interne (pour les logs / le sender)
 *     title: string,
 *     subtitle?: string,
 *     imageUrl?: string,            // affichée dans l'overlay de chargement et les notifs Cast
 *     url: string,                  // URL du manifeste HLS/DASH ou MP4 direct
 *     contentType: string,          // 'application/x-mpegURL' | 'application/dash+xml' | 'video/mp4' | 'audio/mp4' ...
 *     streamType: 'VOD' | 'LIVE',
 *     duration?: number,            // secondes — optionnel pour LIVE
 *     headers?: { [key: string]: string },       // headers HTTP pour le manifeste/segments
 *     drm?: {
 *       licenseUrl: string,
 *       headers?: { [key: string]: string },     // headers HTTP pour la requête de licence
 *       keySystem?: 'widevine' | 'playready',     // défaut : 'widevine'
 *       unwrapJson?: boolean,        // true si la licence est encapsulée en JSON
 *                                    //   { status: 'OK', license: '<base64>' } — cas DRMToday.
 *                                    //   défaut : false (réponse binaire brute)
 *     },
 *     introMarker?: { startMs: number, endMs: number },
 *     outroMarker?: { startMs: number, endMs: number },
 *     startPositionMs?: number,     // reprise de lecture (progression sauvegardée côté app)
 *   },
 *   queue?: Array<MediaPayload>,    // vidéos suivantes (enchaînement sans fermer la session)
 * }
 *
 * SetAudioTrackPayload      { type: 'SET_AUDIO_TRACK',    trackId: string }
 * SetSubtitleTrackPayload   { type: 'SET_SUBTITLE_TRACK', trackId: string | null } // null = désactiver
 * SetPlaybackSpeedPayload   { type: 'SET_PLAYBACK_SPEED', speed: number }          // 0.5 .. 2.0
 * SetQualityPayload         { type: 'SET_QUALITY', height: number | 'auto' }       // ex: 720, 1080, 'auto'
 * SkipIntroPayload          { type: 'SKIP_INTRO', toMs: number }
 * RequestStatePayload       { type: 'REQUEST_STATE' }
 *
 * StateUpdatePayload
 * {
 *   type: 'STATE_UPDATE',
 *   playerState: 'IDLE' | 'LOADING' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'ENDED' | 'ERROR',
 *   contentId?: string,
 *   positionMs: number,
 *   durationMs: number,
 *   liveSeekableRangeMs?: { start: number, end: number },
 *   playbackSpeed: number,
 *   quality: { height: number | 'auto', availableHeights: number[] },
 *   audioTrack: { id: string | null, label: string | null, available: Array<{id: string, label: string}> },
 *   subtitleTrack: { id: string | null, label: string | null, available: Array<{id: string, label: string}> },
 *   queueIndex?: number,
 *   queueLength?: number,
 * }
 *
 * ErrorPayload
 * {
 *   type: 'PLAYBACK_ERROR',
 *   category: 'DRM' | 'NETWORK' | 'NOT_FOUND' | 'INVALID_LICENSE' | 'TIMEOUT' | 'UNKNOWN',
 *   message: string,        // message technique (debug)
 *   contentId?: string,
 * }
 *
 * SkipIntroVisibilityPayload  { type: 'SKIP_INTRO_VISIBILITY', visible: boolean }
 * VideoChangedPayload         { type: 'VIDEO_CHANGED', contentId: string, queueIndex: number }
 */

// Exposition globale pour les autres scripts du receiver
window.STREAMHUB_NAMESPACE = STREAMHUB_NAMESPACE;
window.SenderMessageType = SenderMessageType;
window.ReceiverMessageType = ReceiverMessageType;
