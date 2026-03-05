DrillUK Reward Slot (FiveM Resource)

Structure:
- fxmanifest.lua            -> FiveM resource manifest
- client/client.lua         -> NUI open/close + callbacks
- server/server.lua         -> reward logic + weighted pick
- html/index.html           -> main NUI screen (single source of truth)
- html/style.css            -> all UI styling
- html/app.js               -> slot logic, animation, audio, effects
- html/assets/audio/*.mp3   -> drop tracks
- html/assets/visual/*      -> visual assets (gif/images)
- index.html                -> repo-root browser/GitHub test launcher (loads html/index.html)

Install:
1) Drop `drilluk_rewardslot` into your server resources folder.
2) Add to server.cfg:
   ensure drilluk_rewardslot

Test:
- In game: /drillreward
- Or from another script:
  exports['drilluk_rewardslot']:OpenRewardSlot()
- Browser/GitHub: open repo-root `index.html`

Notes:
- Replace server reward logic in server/server.lua -> giveReward()
- Emoji icons can be swapped for images by editing html/app.js + adding assets to html/
