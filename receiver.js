/**
 * receiver.js
 * ─────────────────────────────────────────────────────────────────────────
 * Point d'entrée du Custom Web Receiver Chromecast (Cast Application
 * Framework / CAF). Reçoit les commandes du sender (app Flutter) via le
 * namespace custom `urn:x-cast:com.streamhub.cast`, pilote le
 * PlayerManager CAF, gère la queue (enchaînement sans relancer la session),
 * le skip intro, et renvoie périodiquement l'état au sender.
 * ─────────────────────────────────────────────────────────────────────────
 */

(function () {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  // ── État interne du receiver ───────────────────────────────────────────

  /** Liste de médias en attente (enchaînement) — voir LOAD_VIDEO.queue */
  let mediaQueue = [];
  let queueIndex = 0;
  let currentMedia = null; // dernier payload `media` chargé

  let introMarker = null;  // { startMs, endMs } courant, ou null
  let outroMarker = null;
  let skipIntroTimerHandle = null;

  let stateIntervalHandle = null;
  const STATE_UPDATE_INTERVAL_MS = 1000;

  /** Garde anti-réentrance : empêche deux LOAD_VIDEO quasi simultanés de
   *  se chevaucher (ex. double appel réseau lent côté sender). */
  let loadInProgress = false;

  // ─────────────────────────────────────────────────────────────────────
  // Configuration du PlaybackConfig (timeouts raisonnables, pas de
  // comportement par défaut "écran noir" de CAF en cas de souci réseau).
  // ─────────────────────────────────────────────────────────────────────

  const playbackConfig = new cast.framework.PlaybackConfig();
  playbackConfig.autoResumeDuration = 5;
  playbackConfig.autoResumeNumberOfSegments = 2;

  // ─────────────────────────────────────────────────────────────────────
  // Interception du LOAD standard de CAF : on construit nous-mêmes le
  // LoadRequestData à partir du message custom LOAD_VIDEO plutôt que de
  // dépendre du format MediaInformation standard envoyé par défaut par
  // certains senders — ici tout passe par notre namespace custom, donc
  // ce hook sert surtout de filet de sécurité / log.
  // ─────────────────────────────────────────────────────────────────────

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD,
    (loadRequestData) => {
      StreamHubUI.showLoading(
        loadRequestData?.media?.metadata?.title || ''
      );
      return loadRequestData;
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // Écran d'attente par défaut tant qu'aucune vidéo n'a été chargée.
  // ─────────────────────────────────────────────────────────────────────

  StreamHubUI.showIdle();

  // ─────────────────────────────────────────────────────────────────────
  // Construction d'un cast.framework.messages.MediaInformation à partir
  // du payload `media` envoyé par le sender (voir messages.js).
  // ─────────────────────────────────────────────────────────────────────

  function buildMediaInformation(media) {
    const mediaInfo = new cast.framework.messages.MediaInformation();
    mediaInfo.contentId = media.url;
    mediaInfo.contentUrl = media.url;
    mediaInfo.contentType = media.contentType || 'application/x-mpegURL';
    mediaInfo.streamType = (media.streamType === 'LIVE')
      ? cast.framework.messages.StreamType.LIVE
      : cast.framework.messages.StreamType.BUFFERED;

    if (media.duration != null) {
      mediaInfo.duration = media.duration;
    }

    const metadata = new cast.framework.messages.GenericMediaMetadata();
    metadata.title = media.title || '';
    if (media.subtitle) metadata.subtitle = media.subtitle;
    if (media.imageUrl) {
      metadata.images = [{ url: media.imageUrl }];
    }
    mediaInfo.metadata = metadata;

    mediaInfo.customData = {
      contentId: media.contentId,
      introMarker: media.introMarker || null,
      outroMarker: media.outroMarker || null,
    };

    return mediaInfo;
  }

  /**
   * Charge un média et l'envoie au PlayerManager. Utilisé à la fois pour
   * le LOAD_VIDEO initial et pour l'enchaînement automatique de la queue.
   * Stoppe proprement toute lecture en cours avant de charger la suivante.
   */
  function loadMedia(media) {
    if (loadInProgress) {
      console.warn('[StreamHub Receiver] LOAD ignoré : un chargement est déjà en cours.');
      return;
    }
    loadInProgress = true;

    currentMedia = media;
    introMarker = media.introMarker || null;
    outroMarker = media.outroMarker || null;
    StreamHubUI.setSkipIntroVisible(false);
    clearSkipIntroTimer();

    StreamHubUI.showLoading(media.title || '');

    // Reconfigure le DRM / headers pour CE média avant de lancer le load.
    StreamHubDrm.applyToPlaybackConfig(playbackConfig, media);
    playerManager.setPlaybackConfig(playbackConfig);

    const mediaInfo = buildMediaInformation(media);
    const request = new cast.framework.messages.LoadRequestData();
    request.media = mediaInfo;
    if (media.startPositionMs != null) {
      request.currentTime = media.startPositionMs / 1000;
    }
    request.autoplay = true;

    playerManager.load(request).then(
      () => {
        loadInProgress = false;
        StreamHubUI.hideAllOverlays();
        broadcastVideoChanged();
      },
      (errorReason) => {
        loadInProgress = false;
        handlePlaybackError('UNKNOWN', `load() a échoué : ${errorReason}`);
      }
    );
  }

  /**
   * Charge la vidéo suivante de la queue, le cas échéant. Retourne true
   * si une vidéo suivante a été lancée, false si la queue est terminée.
   */
  function loadNextInQueue() {
    if (queueIndex + 1 < mediaQueue.length) {
      queueIndex += 1;
      loadMedia(mediaQueue[queueIndex]);
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Skip Intro : surveillance de la position de lecture pour afficher /
  // masquer le bouton, et déclenchement du seek.
  // ─────────────────────────────────────────────────────────────────────

  function clearSkipIntroTimer() {
    if (skipIntroTimerHandle != null) {
      clearInterval(skipIntroTimerHandle);
      skipIntroTimerHandle = null;
    }
  }

  function startSkipIntroWatcher() {
    clearSkipIntroTimer();
    skipIntroTimerHandle = setInterval(() => {
      if (!introMarker) return;
      const positionMs = (playerManager.getCurrentTimeSec() || 0) * 1000;
      const within = positionMs >= introMarker.startMs && positionMs < introMarker.endMs;
      if (within !== StreamHubUI.isSkipIntroVisible()) {
        StreamHubUI.setSkipIntroVisible(within, () => doSkipIntro(introMarker.endMs));
        sendToAllSenders(ReceiverMessageType.SKIP_INTRO_VISIBILITY, { visible: within });
      }
    }, 250);
  }

  function doSkipIntro(toMs) {
    playerManager.seek({ currentTime: toMs / 1000 });
    StreamHubUI.setSkipIntroVisible(false);
    sendToAllSenders(ReceiverMessageType.SKIP_INTRO_VISIBILITY, { visible: false });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Gestion des erreurs — jamais d'écran noir, toujours un overlay clair.
  // ─────────────────────────────────────────────────────────────────────

  function handlePlaybackError(category, debugDetail) {
    clearSkipIntroTimer();
    StreamHubUI.showError(StreamHubUI.errorCategoryLabel(category), debugDetail);
    sendToAllSenders(ReceiverMessageType.PLAYBACK_ERROR, {
      category,
      message: debugDetail || '',
      contentId: currentMedia ? currentMedia.contentId : undefined,
    });
  }

  playerManager.addEventListener(
    cast.framework.events.EventType.ERROR,
    (event) => {
      const DEC = cast.framework.events.DetailedErrorCode;
      const detailedCode = event.detailedErrorCode;
      // HTTP status réel s'il est disponible (présent sur les erreurs
      // réseau de type SEGMENT_NETWORK / HLS_NETWORK_* / DASH_NETWORK,
      // voir event.error.requestStatus.status dans les rapports CAF).
      const httpStatus = event?.error?.requestStatus?.status;

      let category = 'UNKNOWN';

      const DRM_CODES = [
        DEC.MEDIAKEYS_UNKNOWN, DEC.MEDIAKEYS_NETWORK,
        DEC.MEDIAKEYS_UNSUPPORTED, DEC.MEDIAKEYS_WEBCRYPTO,
        DEC.HLS_NETWORK_NO_KEY_RESPONSE, DEC.HLS_NETWORK_KEY_LOAD,
      ];
      const NETWORK_CODES = [
        DEC.NETWORK_UNKNOWN, DEC.SEGMENT_NETWORK,
        DEC.HLS_NETWORK_MASTER_PLAYLIST, DEC.HLS_NETWORK_PLAYLIST,
        DEC.HLS_NETWORK_INVALID_SEGMENT, DEC.DASH_NETWORK,
        DEC.SMOOTH_NETWORK, DEC.MEDIA_NETWORK,
      ];
      const NOT_FOUND_CODES = [
        DEC.MANIFEST_UNKNOWN, DEC.HLS_MANIFEST_MASTER, DEC.HLS_MANIFEST_PLAYLIST,
        DEC.DASH_MANIFEST_UNKNOWN, DEC.DASH_MANIFEST_NO_PERIODS,
        DEC.DASH_MANIFEST_NO_MIMETYPE, DEC.SMOOTH_MANIFEST,
        DEC.MEDIA_SRC_NOT_SUPPORTED,
      ];

      if (DRM_CODES.includes(detailedCode)) {
        category = 'DRM';
      } else if (NETWORK_CODES.includes(detailedCode)) {
        // Distinction réseau / introuvable / timeout à partir du statut
        // HTTP réel quand il est exposé par l'event ; sinon NETWORK par
        // défaut (cas générique, ex. DNS, coupure de connexion).
        if (httpStatus === 404) {
          category = 'NOT_FOUND';
        } else if (httpStatus === 403 || httpStatus === 401) {
          category = 'INVALID_LICENSE';
        } else if (httpStatus === 408 || httpStatus === 504) {
          category = 'TIMEOUT';
        } else {
          category = 'NETWORK';
        }
      } else if (NOT_FOUND_CODES.includes(detailedCode)) {
        category = 'NOT_FOUND';
      } else if (detailedCode === DEC.LOAD_INTERRUPTED || detailedCode === DEC.LOAD_FAILED) {
        category = 'NETWORK';
      }

      handlePlaybackError(category, `CAF error (code ${detailedCode}): ${JSON.stringify(event)}`);
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // Fin de vidéo → enchaînement automatique si une suite existe.
  // ─────────────────────────────────────────────────────────────────────

  playerManager.addEventListener(
    cast.framework.events.EventType.ENDED,
    () => {
      clearSkipIntroTimer();
      const hasNext = loadNextInQueue();
      if (!hasNext) {
        StreamHubUI.showIdle();
        currentMedia = null;
      }
    }
  );

  playerManager.addEventListener(
    cast.framework.events.EventType.PLAYING,
    () => {
      StreamHubUI.hideAllOverlays();
      startSkipIntroWatcher();
    }
  );

  playerManager.addEventListener(
    cast.framework.events.EventType.BUFFERING,
    () => {
      // On ne réaffiche pas l'overlay de chargement plein écran pendant un
      // simple rebuffering en cours de lecture — le <cast-media-player>
      // affiche déjà son propre indicateur natif sur la vidéo visible.
      // L'overlay "Chargement..." ne sert qu'au LOAD initial.
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // Construction du STATE_UPDATE envoyé périodiquement au(x) sender(s).
  // ─────────────────────────────────────────────────────────────────────

  function mapPlayerState() {
    const PS = cast.framework.messages.PlayerState;
    const s = playerManager.getPlayerState();
    switch (s) {
      case PS.IDLE: return 'IDLE';
      case PS.LOADING: return 'LOADING';
      case PS.PLAYING: return 'PLAYING';
      case PS.PAUSED: return 'PAUSED';
      case PS.BUFFERING: return 'BUFFERING';
      default: return 'IDLE';
    }
  }

  function buildStateUpdate() {
    let audioTrack = { id: null, label: null, available: [] };
    let subtitleTrack = { id: null, label: null, available: [] };

    // Lecture des pistes isolée : pendant le parsing initial d'un
    // manifeste (notamment juste après LOAD, avant que CAF ait fini
    // d'analyser les AdaptationSets), ces appels peuvent légitimement
    // échouer — on ne veut pas perdre position/durée/playerState pour
    // autant.
    try {
      const audioTracksManager = playerManager.getAudioTracksManager();
      const activeAudioId = audioTracksManager.getActiveTrackIds()[0];
      const activeAudioTrack = activeAudioId != null
        ? audioTracksManager.getTrackById(activeAudioId)
        : null;
      audioTrack = {
        id: activeAudioTrack ? String(activeAudioTrack.trackId) : null,
        label: activeAudioTrack ? (activeAudioTrack.name || activeAudioTrack.language) : null,
        available: (audioTracksManager.getTracks() || []).map(t => ({
          id: String(t.trackId),
          label: t.name || t.language || `Piste ${t.trackId}`,
        })),
      };
    } catch (e) {
      console.warn('[StreamHub Receiver] Lecture pistes audio impossible (probablement manifeste pas encore prêt) :', e);
    }

    try {
      const textTracksManager = playerManager.getTextTracksManager();
      const activeTextIds = textTracksManager.getActiveTrackIds() || [];
      const activeTextId = activeTextIds.length > 0 ? activeTextIds[0] : null;
      const activeTextTrack = activeTextId != null
        ? textTracksManager.getTrackById(activeTextId)
        : null;
      subtitleTrack = {
        id: activeTextTrack ? String(activeTextTrack.trackId) : null,
        label: activeTextTrack ? (activeTextTrack.name || activeTextTrack.language) : null,
        available: (textTracksManager.getTracks() || []).map(t => ({
          id: String(t.trackId),
          label: t.name || t.language || `Sous-titres ${t.trackId}`,
        })),
      };
    } catch (e) {
      console.warn('[StreamHub Receiver] Lecture pistes sous-titres impossible :', e);
    }

    return {
      playerState: mapPlayerState(),
      contentId: currentMedia ? currentMedia.contentId : undefined,
      positionMs: Math.round((playerManager.getCurrentTimeSec() || 0) * 1000),
      durationMs: Math.round((playerManager.getDurationSec() || 0) * 1000),
      playbackSpeed: playerManager.getPlaybackRate ? playerManager.getPlaybackRate() : 1.0,
      quality: { height: 'auto' }, // sélection de qualité forcée non gérée (hors scope)
      audioTrack,
      subtitleTrack,
      queueIndex,
      queueLength: mediaQueue.length,
    };
  }

  function broadcastState() {
    try {
      sendToAllSenders(ReceiverMessageType.STATE_UPDATE, buildStateUpdate());
    } catch (e) {
      // Ne JAMAIS laisser une exception ici tuer silencieusement le
      // setInterval qui pilote toute la synchronisation d'état — sans
      // cette protection, un seul appel CAF qui throw (ex. tracks pas
      // encore disponibles pendant le parsing initial du manifeste) coupe
      // tous les STATE_UPDATE futurs sans aucun signal visible côté sender.
      console.error('[StreamHub Receiver] broadcastState() a échoué :', e);
    }
  }

  function broadcastVideoChanged() {
    sendToAllSenders(ReceiverMessageType.VIDEO_CHANGED, {
      contentId: currentMedia ? currentMedia.contentId : '',
      queueIndex,
    });
  }

  function startStateBroadcastLoop() {
    if (stateIntervalHandle != null) return;
    stateIntervalHandle = setInterval(broadcastState, STATE_UPDATE_INTERVAL_MS);
  }

  function sendToAllSenders(type, payload) {
    context.sendCustomMessage(STREAMHUB_NAMESPACE, undefined, { type, ...payload });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Réception des messages custom envoyés par le sender.
  // ─────────────────────────────────────────────────────────────────────

  context.addCustomMessageListener(STREAMHUB_NAMESPACE, (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case SenderMessageType.LOAD_VIDEO: {
        mediaQueue = [msg.media, ...(msg.queue || [])];
        queueIndex = 0;
        loadMedia(mediaQueue[0]);
        break;
      }

      case SenderMessageType.SET_AUDIO_TRACK: {
        const id = Number(msg.trackId);
        if (!Number.isNaN(id)) {
          playerManager.getAudioTracksManager().setActiveTrackIds([id]);
          broadcastState();
        }
        break;
      }

      case SenderMessageType.SET_SUBTITLE_TRACK: {
        const textTracksManager = playerManager.getTextTracksManager();
        if (msg.trackId == null) {
          textTracksManager.setActiveTrackIds([]);
        } else {
          const id = Number(msg.trackId);
          if (!Number.isNaN(id)) {
            textTracksManager.setActiveTrackIds([id]);
          }
        }
        broadcastState();
        break;
      }

      case SenderMessageType.SET_PLAYBACK_SPEED: {
        const speed = Number(msg.speed);
        if (!Number.isNaN(speed) && speed > 0) {
          playerManager.setPlaybackRate(speed);
          broadcastState();
        }
        break;
      }

      case SenderMessageType.SET_QUALITY: {
        // Qualité forcée non gérée (hors scope) : message acquitté sans effet.
        broadcastState();
        break;
      }

      case SenderMessageType.SKIP_INTRO: {
        doSkipIntro(msg.toMs);
        break;
      }

      case SenderMessageType.REQUEST_STATE: {
        broadcastState();
        break;
      }

      default:
        break;
    }
  });

  // (Sélection de qualité forcée : hors scope, non implémentée.)

  // ─────────────────────────────────────────────────────────────────────
  // Télécommande Chromecast :
  // - OK déclenche le Skip Intro si affiché, sinon laisse passer (CAF gère
  //   Lecture/Pause/Gauche/Droite nativement sur les touches dédiées).
  // - Retour (touche back de la télécommande Android TV / Google TV) :
  //   met en pause puis affiche l'écran d'attente si on est dans un état
  //   stable, pour donner un point de sortie clair plutôt que de laisser
  //   CAF décider d'un comportement implicite.
  // ─────────────────────────────────────────────────────────────────────

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.SEEK,
    (seekRequestData) => seekRequestData // laisse passer ; le seek standard suffit pour Gauche/Droite
  );

  /**
   * Note SDK : le Web Receiver framework suit automatiquement les
   * connexions/déconnexions de senders ; un listener SENDER_DISCONNECTED
   * explicite n'est PAS requis pour le fonctionnement de base. On
   * l'utilise ici uniquement pour un comportement métier précis : si plus
   * AUCUN sender n'est connecté (téléphone fermé/déconnecté sans qu'aucun
   * autre appareil ne pilote la session), on revient à l'écran d'attente
   * plutôt que de laisser une vidéo orpheline jouer indéfiniment sans
   * personne pour la contrôler ou sauvegarder sa progression.
   */
  context.addEventListener(
    cast.framework.system.EventType.SENDER_DISCONNECTED,
    () => {
      const remainingSenders = context.getSenders();
      if (remainingSenders && remainingSenders.length > 0) {
        return; // un autre sender contrôle toujours la session, on ne touche à rien
      }
      clearSkipIntroTimer();
      playerManager.stop();
      currentMedia = null;
      mediaQueue = [];
      queueIndex = 0;
      StreamHubUI.showIdle();
    }
  );

  // IMPORTANT : écoute en phase de CAPTURE (3e argument `true`), pas en
  // phase de bouillonnement (bubbling) par défaut. Le composant natif
  // <cast-media-player> a sa propre gestion interne du bouton OK de la
  // télécommande (il l'utilise pour togglee play/pause sur ses contrôles
  // visibles) et peut intercepter/arrêter l'event avant qu'il ne nous
  // atteigne si on écoute en bubbling. En capture, notre listener voit
  // l'event AVANT le cast-media-player, donc avant qu'il puisse le
  // consommer en interne.
  // Filet de sécurité supplémentaire : sur certains appareils/firmwares,
  // le bouton OK de la télécommande peut être traduit directement par CAF
  // en commande standard PAUSE plutôt qu'en keydown DOM brut (ce qui
  // expliquerait une mise en pause au lieu du skip si le keydown n'était
  // jamais vu). En interceptant le message PAUSE lui-même, on peut
  // détourner cette commande vers le skip intro quand le bouton est
  // affiché, indépendamment de la façon dont la télécommande a été
  // traduite en amont.
  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.PAUSE,
    (pauseRequestData) => {
      if (StreamHubUI.isSkipIntroVisible()) {
        const skipped = StreamHubUI.activateSkipIntroIfVisible();
        console.log('[StreamHub Receiver] PAUSE intercepté pendant Skip Intro visible → skip déclenché à la place : ' + skipped);
        if (skipped) {
          // On annule la pause en ne laissant PAS passer la requête.
          return null;
        }
      }
      return pauseRequestData;
    }
  );

  const handleRemoteKeydown = (event) => {
    const isOk = event.keyCode === 13 || event.key === 'Enter' || event.code === 'Enter' || event.code === 'Select';
    const isBack = event.keyCode === 27 || event.keyCode === 4
      || event.key === 'Escape' || event.key === 'BrowserBack' || event.key === 'GoBack' || event.code === 'Escape';

    if (isOk) {
      const skipped = StreamHubUI.activateSkipIntroIfVisible();
      console.log('[StreamHub Receiver] Touche OK reçue. skipIntroVisible=' + StreamHubUI.isSkipIntroVisible() + ' → skipped=' + skipped);
      if (skipped) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
      }
      return;
    }

    if (isBack) {
      const state = playerManager.getPlayerState();
      const PS = cast.framework.messages.PlayerState;
      if (state === PS.PLAYING || state === PS.PAUSED || state === PS.BUFFERING) {
        playerManager.pause();
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
      }
      // Si déjà à l'arrêt/IDLE, on laisse CAF gérer son comportement par
      // défaut (peut fermer l'application sur certaines plateformes).
    }
  };

  // On écoute à DEUX endroits, en phase de capture (avant que la cible ne
  // traite l'event) :
  // 1. document — cas général.
  // 2. le <cast-media-player> lui-même — car ce composant gère en interne
  //    le bouton OK pour son propre toggle play/pause, et selon la
  //    composition de son Shadow DOM, il peut arrêter la propagation de
  //    l'event avant même que la phase de capture descendante depuis
  //    `document` n'ait formellement "traversé" sa frontière logique. En
  //    écoutant directement dessus en capture, on intercepte l'event au
  //    plus tôt possible, avant que le composant ne le traite lui-même.
  document.addEventListener('keydown', handleRemoteKeydown, true);
  const castPlayerEl = document.getElementById('player');
  if (castPlayerEl) {
    castPlayerEl.addEventListener('keydown', handleRemoteKeydown, true);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Options de démarrage du receiver.
  // ─────────────────────────────────────────────────────────────────────

  const options = new cast.framework.CastReceiverOptions();
  options.playbackConfig = playbackConfig;
  options.disableIdleTimeout = true; // l'écran "Prêt à diffuser" gère l'attente, pas le timeout par défaut de CAF
  options.maxInactivity = 3600; // secondes — la session ne se ferme pas trop vite entre deux vidéos

  context.start(options);
  startStateBroadcastLoop();
})();
