# Comment tester le receiver avec tester.html

## 1. Préparer le déploiement

Vous devez héberger **tous les fichiers** de ce dossier (`index.html`, `messages.js`,
`drm.js`, `ui.js`, `receiver.js`, `assets/`, et maintenant `tester.html` + `tester.js`)
sur la même origine HTTPS publique. `tester.html` est juste une page de plus sur le
même site — pas besoin de la déployer séparément.

Donc votre arborescence en ligne doit ressembler à :
```
https://votre-domaine.com/cast/index.html      ← le receiver (déclaré sur la Cast Console)
https://votre-domaine.com/cast/tester.html      ← la page de test (sender)
https://votre-domaine.com/cast/messages.js
https://votre-domaine.com/cast/drm.js
...
```

## 2. Enregistrer le receiver (une seule fois)

Suivre les étapes du README.md principal (section 2) : créer l'app Custom Receiver
sur https://cast.google.com/publish, pointer vers `index.html`, ajouter votre
Chromecast de test, récupérer l'**App ID**.

## 3. Ouvrir tester.html

- Dans **Google Chrome desktop** (le SDK Sender Web ne fonctionne que dans Chrome).
- Ouvrez `https://votre-domaine.com/cast/tester.html`.
- Collez votre App ID dans le champ prévu, cliquez "Initialiser le SDK Sender".
- Cliquez sur l'icône Cast qui apparaît, choisissez votre Chromecast.
- Le point de statut doit passer au vert ("Connecté").

## 4. Tester chaque fonctionnalité

La page est organisée pour suivre exactement le cahier des charges :

| Section de la page          | Ce qu'elle teste                                          |
|------------------------------|------------------------------------------------------------|
| 2. Charger une vidéo         | LOAD_VIDEO — collez une URL HLS (.m3u8) ou DASH (.mpd)     |
| → DRM (optionnel)            | Licence Widevine, y compris le cas DRMToday (case à cocher)|
| → Skip Intro (optionnel)     | Renseignez un intervalle pour voir apparaître le bouton    |
| → Queue (optionnel)          | Renseignez une 2e URL pour tester l'enchaînement auto      |
| 3. Contrôles de lecture      | Play/Pause/Stop, seek ±10s, seek précis, vitesse, skip intro manuel |
| 4. Pistes                    | Changement audio / sous-titres à chaud                    |
| 5. Dernier état reçu         | Vérifie que STATE_UPDATE arrive bien toutes les ~1s        |
| Checklist                    | Cases à cocher au fur et à mesure de vos tests             |
| Journal des messages         | Tout ce qui part (→) et arrive (←) sur le namespace custom |

## 5. Scénarios à enchaîner

1. **Premier lancement** : avant tout LOAD, vérifiez sur le téléviseur l'écran
   "Prêt à diffuser" (pas d'écran noir).
2. **Charger une vidéo HLS sans DRM** : vérifiez l'écran de chargement puis la
   lecture qui démarre.
3. **Charger une vidéo DASH avec DRM Widevine** : si la licence DRMToday renvoie
   du JSON, cochez "Unwrap JSON" — sinon laissez décoché.
4. **Pendant la lecture** : testez Pause/Play, seek ±10s, seek précis, vitesse 1.5×.
5. **Si la vidéo a plusieurs pistes** : changez la piste audio et les sous-titres,
   vérifiez que le son/les sous-titres changent réellement sur le téléviseur.
6. **Avec un intervalle Skip Intro renseigné** : avancez (seek) jusqu'à entrer dans
   l'intervalle, vérifiez que le bouton apparaît sur le téléviseur ET que la ligne
   "Skip Intro AFFICHÉ" apparaît dans le journal. Cliquez sur le bouton "Skip Intro"
   du testeur, ou appuyez sur OK sur la télécommande Chromecast — vérifiez le seek.
7. **Avec une queue renseignée** : laissez la première vidéo arriver à sa fin (ou
   testez sur un fichier court) — vérifiez l'enchaînement automatique sans coupure
   de session, et le message VIDEO_CHANGED dans le journal.
8. **Charger une nouvelle vidéo en cours de lecture** : remplissez à nouveau le
   formulaire LOAD avec une autre URL et cliquez "Charger" pendant que la première
   joue encore — vérifiez le remplacement immédiat et propre.
9. **Erreur volontaire** : collez une URL invalide ou inexistante et chargez —
   vérifiez l'écran d'erreur clair sur le téléviseur (jamais noir) et le message
   PLAYBACK_ERROR catégorisé dans le journal.
10. **Touche Retour de la télécommande** : pendant la lecture, appuyez sur Retour
    sur la télécommande Chromecast/Android TV — vérifiez la mise en pause.
11. **Fin de session** : cliquez "Terminer la session" — vérifiez le retour à
    l'écran d'attente côté receiver (testez aussi en fermant juste l'onglet Chrome
    sans cliquer sur le bouton, pour valider SENDER_DISCONNECTED).

## Notes

- Le testeur n'implémente pas la commande `SET_QUALITY` à l'écran (hors scope,
  comme convenu) — il n'y a donc pas de bouton qualité.
- Si vous voyez "Aucune session active" dans le journal en rouge, c'est que vous
  avez cliqué un bouton de contrôle avant que la connexion Cast soit établie.
- Le journal différencie : `→` (envoyé par le testeur), `←` (reçu du receiver),
  `⚠` (erreur), `·` (info système).
