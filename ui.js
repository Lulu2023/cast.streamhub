/**
 * ui.js
 * ─────────────────────────────────────────────────────────────────────────
 * Gestion des overlays custom affichés par-dessus le <cast-media-player> :
 * - écran d'attente ("Prêt à diffuser")
 * - écran de chargement (titre + spinner)
 * - écran d'erreur
 * - bouton "Passer l'intro"
 *
 * Le <cast-media-player> du CAF gère lui-même l'UI de lecture standard
 * (barre de progression, contrôles...). Ces overlays ne s'affichent QUE
 * dans les états où le player CAF n'a rien d'utile à montrer (évite tout
 * écran noir), ou pour des éléments que CAF ne fournit pas nativement
 * (skip intro).
 * ─────────────────────────────────────────────────────────────────────────
 */

const StreamHubUI = (() => {

  const idleOverlay = document.getElementById('idleOverlay');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const errorOverlay = document.getElementById('errorOverlay');
  const loadingVideoTitleEl = document.getElementById('loadingVideoTitle');
  const errorMessageEl = document.getElementById('errorMessage');
  const skipIntroButton = document.getElementById('skipIntroButton');

  const ALL_OVERLAYS = [idleOverlay, loadingOverlay, errorOverlay];

  function _showOnly(overlay) {
    ALL_OVERLAYS.forEach(el => el.classList.toggle('visible', el === overlay));
  }

  function showIdle() {
    _showOnly(idleOverlay);
  }

  function showLoading(title) {
    loadingVideoTitleEl.textContent = title || '';
    _showOnly(loadingOverlay);
  }

  /**
   * @param {string} categoryLabel - libellé lisible déjà résolu (FR)
   * @param {string} [debugDetail] - non affiché à l'utilisateur, utile en log
   */
  function showError(categoryLabel, debugDetail) {
    errorMessageEl.textContent = categoryLabel;
    _showOnly(errorOverlay);
    if (debugDetail) {
      console.error('[StreamHubUI] Erreur de lecture :', debugDetail);
    }
  }

  function hideAllOverlays() {
    ALL_OVERLAYS.forEach(el => el.classList.remove('visible'));
  }

  /**
   * Traduit une catégorie d'erreur interne en message FR clair pour
   * l'utilisateur (jamais de détail technique brut affiché à l'écran).
   */
  function errorCategoryLabel(category) {
    switch (category) {
      case 'DRM':
        return 'Impossible de lancer la lecture : erreur de protection du contenu (DRM).';
      case 'NETWORK':
        return 'Impossible de lancer la lecture : problème de connexion réseau.';
      case 'NOT_FOUND':
        return 'Impossible de lancer la lecture : vidéo introuvable.';
      case 'INVALID_LICENSE':
        return 'Impossible de lancer la lecture : licence invalide.';
      case 'TIMEOUT':
        return 'Impossible de lancer la lecture : délai dépassé.';
      default:
        return 'Impossible de lancer la lecture.';
    }
  }

  // ── Bouton Skip Intro ──────────────────────────────────────────────────

  let _skipIntroVisible = false;
  let _onSkipIntroActivate = null;

  function setSkipIntroVisible(visible, onActivate) {
    if (visible === _skipIntroVisible) return;
    _skipIntroVisible = visible;
    skipIntroButton.classList.toggle('visible', visible);
    _onSkipIntroActivate = visible ? onActivate : null;
  }

  function isSkipIntroVisible() {
    return _skipIntroVisible;
  }

  /** Appelé par receiver.js lors d'un appui sur OK de la télécommande. */
  function activateSkipIntroIfVisible() {
    if (_skipIntroVisible && typeof _onSkipIntroActivate === 'function') {
      _onSkipIntroActivate();
      return true;
    }
    return false;
  }

  return {
    showIdle,
    showLoading,
    showError,
    hideAllOverlays,
    errorCategoryLabel,
    setSkipIntroVisible,
    isSkipIntroVisible,
    activateSkipIntroIfVisible,
  };
})();

window.StreamHubUI = StreamHubUI;
