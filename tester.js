/**
 * tester.js
 * ─────────────────────────────────────────────────────────────────────────
 * Sender de test minimal pour valider toutes les fonctions du Custom Web
 * Receiver (urn:x-cast:com.streamhub.cast), sans dépendre de l'app Flutter.
 *
 * Utilise le SDK Web Sender officiel de Google (cast_sender.js / CAF) —
 * https://developers.google.com/cast/docs/web_sender — chargé dans
 * tester.html avant ce fichier.
 * ─────────────────────────────────────────────────────────────────────────
 */

const NAMESPACE = 'urn:x-cast:com.streamhub.cast';
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

let castSession = null;
let remotePlayer = null;
let remotePlayerController = null;

// ── Logging ────────────────────────────────────────────────────────────

const logEl = document.getElementById('log');

function log(direction, message) {
  const cls = direction === 'out' ? 'l-out' : direction === 'in' ? 'l-in' : direction === 'err' ? 'l-err' : 'l-sys';
  const prefix = direction === 'out' ? '→ ' : direction === 'in' ? '← ' : direction === 'err' ? '⚠ ' : '· ';
  const time = new Date().toLocaleTimeString('fr-FR');
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${time}] ${prefix}${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('btnClearLog').addEventListener('click', () => {
  logEl.innerHTML = '';
});

// ── Initialisation du SDK Cast ───────────────────────────────────────────

window['__onGCastApiAvailable'] = function (isAvailable) {
  if (isAvailable) {
    log('sys', 'SDK Cast disponible. Renseignez un App ID puis cliquez sur "Initialiser le SDK Sender".');
  } else {
    log('err', 'SDK Cast non disponible dans ce navigateur (utilisez Google Chrome desktop).');
  }
};

document.getElementById('btnInit').addEventListener('click', initializeCastApi);

function initializeCastApi() {
  const appIdInput = document.getElementById('appId').value.trim();
  const appId = appIdInput || DEFAULT_MEDIA_RECEIVER_APP_ID;

  if (!appIdInput) {
    log('sys', `Aucun App ID renseigné — utilisation du récepteur média par défaut Google (${DEFAULT_MEDIA_RECEIVER_APP_ID}). Vos messages custom ne seront PAS traités par celui-ci.`);
  }

  cast.framework.CastContext.getInstance().setOptions({
    receiverApplicationId: appId,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  // Injecte le bouton Cast natif du navigateur.
  const container = document.getElementById('castButtonContainer');
  container.innerHTML = '';
  const launcher = document.createElement('google-cast-launcher');
  launcher.id = 'castLauncher';
  launcher.style.cssText = 'width: 36px; height: 36px; display: inline-block; vertical-align: middle;';
  container.appendChild(launcher);
  const helpText = document.createElement('span');
  helpText.style.cssText = 'margin-left: 10px; color: var(--muted); font-size: 13px;';
  helpText.textContent = 'Cliquez sur l\'icône pour choisir votre Chromecast';
  container.appendChild(helpText);

  cast.framework.CastContext.getInstance().addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    onSessionStateChanged
  );

  remotePlayer = new cast.framework.RemotePlayer();
  remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);
  remotePlayerController.addEventListener(
    cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
    () => {
      if (!remotePlayer.isConnected) {
        castSession = null;
        onDisconnected();
      }
    }
  );

  log('sys', `SDK Sender initialisé avec App ID = ${appId}.`);
}

function onSessionStateChanged(event) {
  const SessionState = cast.framework.SessionState;
  switch (event.sessionState) {
    case SessionState.SESSION_STARTED:
    case SessionState.SESSION_RESUMED:
      castSession = cast.framework.CastContext.getInstance().getCurrentSession();
      onConnected();
      break;
    case SessionState.SESSION_ENDED:
      castSession = null;
      onDisconnected();
      break;
    default:
      break;
  }
}

function onConnected() {
  setConnectionStatus(true);
  setControlsEnabled(true); // priorité : ne doit jamais être bloqué par ce qui suit

  try {
    const deviceName = castSession.getCastDevice()?.friendlyName || '(nom inconnu)';
    log('sys', `Connecté à : ${deviceName}`);
  } catch (e) {
    log('err', `Impossible de lire le nom de l'appareil : ${e}`);
  }

  try {
    castSession.addMessageListener(NAMESPACE, (ns, message) => {
      handleIncomingMessage(message);
    });
  } catch (e) {
    log('err', `Impossible d'écouter le namespace custom : ${e}`);
  }
}

function onDisconnected() {
  setConnectionStatus(false);
  setControlsEnabled(false);
  log('sys', 'Session terminée.');
}

function setConnectionStatus(connected) {
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  if (connected) {
    dot.className = 'dot connected';
    text.textContent = 'Connecté';
  } else {
    dot.className = 'dot';
    text.textContent = 'Non connecté';
  }
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('button, select').forEach((el) => {
    if (el.id === 'btnInit') return;
    el.disabled = !enabled;
  });
}

// ── Envoi de messages custom ─────────────────────────────────────────────

function sendMessage(payload) {
  if (!castSession) {
    log('err', 'Aucune session active — connectez-vous à un Chromecast.');
    return;
  }
  log('out', JSON.stringify(payload));
  castSession.sendMessage(NAMESPACE, payload).catch((err) => {
    log('err', `Échec d'envoi : ${err}`);
  });
}

function handleIncomingMessage(message) {
  log('in', JSON.stringify(message));

  switch (message.type) {
    case 'STATE_UPDATE':
      renderState(message);
      break;
    case 'PLAYBACK_ERROR':
      log('err', `Erreur receiver [${message.category}] : ${message.message}`);
      break;
    case 'SKIP_INTRO_VISIBILITY':
      log('sys', `Skip Intro ${message.visible ? 'AFFICHÉ' : 'masqué'} sur le receiver.`);
      break;
    case 'VIDEO_CHANGED':
      log('sys', `Vidéo changée sur le receiver : contentId=${message.contentId}, queueIndex=${message.queueIndex}`);
      break;
    default:
      break;
  }
}

// ── Rendu de l'état reçu ──────────────────────────────────────────────────

function formatSeconds(ms) {
  const totalSec = Math.round((ms || 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderState(state) {
  const kv = document.getElementById('stateKv');
  kv.innerHTML = `
    <div>playerState</div><div>${state.playerState}</div>
    <div>position</div><div>${formatSeconds(state.positionMs)}</div>
    <div>durée</div><div>${formatSeconds(state.durationMs)}</div>
    <div>vitesse</div><div>${state.playbackSpeed}×</div>
    <div>piste audio</div><div>${state.audioTrack?.label || '—'}</div>
    <div>sous-titres</div><div>${state.subtitleTrack?.label || 'désactivés'}</div>
    <div>queue</div><div>${(state.queueIndex ?? 0) + 1} / ${state.queueLength ?? 1}</div>
  `;

  updateTrackSelect('audioTrackSelect', state.audioTrack);
  updateTrackSelect('subtitleTrackSelect', state.subtitleTrack, true);
}

function updateTrackSelect(selectId, trackInfo, isSubtitle) {
  const select = document.getElementById(selectId);
  if (!trackInfo) return;

  const currentSelection = select.value;
  select.innerHTML = '';

  if (isSubtitle) {
    const offOption = document.createElement('option');
    offOption.value = '';
    offOption.textContent = 'Désactivés';
    select.appendChild(offOption);
  }

  (trackInfo.available || []).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    select.appendChild(opt);
  });

  // Préserve la sélection visuelle si elle correspond toujours à une option,
  // sinon reflète la piste active rapportée par le receiver.
  const desired = trackInfo.id != null ? String(trackInfo.id) : '';
  if ([...select.options].some((o) => o.value === currentSelection)) {
    select.value = currentSelection;
  } else {
    select.value = desired;
  }
}

// ── Construction et envoi de LOAD_VIDEO ──────────────────────────────────

function safeParseJson(text) {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    log('err', `JSON invalide ignoré : ${e.message}`);
    return {};
  }
}

document.getElementById('btnLoad').addEventListener('click', () => {
  const url = document.getElementById('mediaUrl').value.trim();
  if (!url) {
    log('err', 'Renseignez une URL de manifeste avant de charger.');
    return;
  }

  const introStart = document.getElementById('introStart').value;
  const introEnd = document.getElementById('introEnd').value;
  const introMarker = (introStart !== '' && introEnd !== '')
    ? { startMs: Number(introStart) * 1000, endMs: Number(introEnd) * 1000 }
    : undefined;

  const licenseUrl = document.getElementById('drmLicenseUrl').value.trim();
  const drm = licenseUrl
    ? {
        licenseUrl,
        headers: safeParseJson(document.getElementById('drmHeaders').value),
        keySystem: 'widevine',
        unwrapJson: document.getElementById('drmUnwrapJson').checked,
      }
    : undefined;

  const media = {
    contentId: 'test-' + Date.now(),
    title: document.getElementById('mediaTitle').value || 'Sans titre',
    url,
    contentType: document.getElementById('contentType').value,
    streamType: document.getElementById('streamType').value,
    headers: safeParseJson(document.getElementById('mediaHeaders').value),
    drm,
    introMarker,
  };

  const queueUrl = document.getElementById('queueUrl').value.trim();
  const queue = [];
  if (queueUrl) {
    queue.push({
      contentId: 'test-queue-' + Date.now(),
      title: 'Vidéo suivante (queue)',
      url: queueUrl,
      contentType: document.getElementById('queueContentType').value,
      streamType: 'VOD',
    });
  }

  sendMessage({ type: 'LOAD_VIDEO', media, ...(queue.length ? { queue } : {}) });
});

// ── Contrôles de lecture ──────────────────────────────────────────────────

document.getElementById('btnPlay').addEventListener('click', () => {
  if (!remotePlayer) return;
  if (remotePlayer.isPaused) {
    remotePlayerController.playOrPause();
    log('sys', 'Play envoyé (RemotePlayerController)');
  } else {
    log('sys', 'Déjà en lecture.');
  }
});

document.getElementById('btnPause').addEventListener('click', () => {
  if (!remotePlayer) return;
  if (!remotePlayer.isPaused) {
    remotePlayerController.playOrPause();
    log('sys', 'Pause envoyé (RemotePlayerController)');
  } else {
    log('sys', 'Déjà en pause.');
  }
});

document.getElementById('btnStop').addEventListener('click', () => {
  if (!remotePlayer) return;
  remotePlayerController.stop();
  log('sys', 'Stop envoyé (RemotePlayerController)');
});

function seekToSeconds(seconds) {
  if (!remotePlayer) return;
  remotePlayer.currentTime = Math.max(0, seconds);
  remotePlayerController.seek();
  log('sys', `Seek à ${Math.max(0, seconds)}s envoyé`);
}

document.getElementById('btnSeekFwd').addEventListener('click', () => {
  seekToSeconds((remotePlayer?.currentTime || 0) + 10);
});

document.getElementById('btnSeekBack').addEventListener('click', () => {
  seekToSeconds((remotePlayer?.currentTime || 0) - 10);
});

document.getElementById('btnSeekTo').addEventListener('click', () => {
  const value = Number(document.getElementById('seekToValue').value);
  if (!Number.isNaN(value)) seekToSeconds(value);
});

document.querySelectorAll('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    sendMessage({ type: 'SET_PLAYBACK_SPEED', speed: Number(btn.dataset.speed) });
  });
});

document.getElementById('btnSkipIntro').addEventListener('click', () => {
  const value = Number(document.getElementById('skipIntroToValue').value);
  if (!Number.isNaN(value)) {
    sendMessage({ type: 'SKIP_INTRO', toMs: value * 1000 });
  }
});

document.getElementById('btnRequestState').addEventListener('click', () => {
  sendMessage({ type: 'REQUEST_STATE' });
});

document.getElementById('btnEndSession').addEventListener('click', () => {
  cast.framework.CastContext.getInstance().endCurrentSession(true);
});

// ── Pistes ─────────────────────────────────────────────────────────────

document.getElementById('audioTrackSelect').addEventListener('change', (e) => {
  if (e.target.value !== '') {
    sendMessage({ type: 'SET_AUDIO_TRACK', trackId: e.target.value });
  }
});

document.getElementById('subtitleTrackSelect').addEventListener('change', (e) => {
  sendMessage({ type: 'SET_SUBTITLE_TRACK', trackId: e.target.value === '' ? null : e.target.value });
});
